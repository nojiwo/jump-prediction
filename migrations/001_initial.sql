-- Jump Prediction PWA — initial database schema (Turso/libSQL compatible SQLite)
-- Date: 2026-10-11. UTC timestamps stored as ISO8601 strings; app performs JST conversions.
PRAGMA foreign_keys = ON;

-- IDs are stable, usernames are mutable.  Founder identity is separately protected by business logic.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(username)) BETWEEN 1 AND 40),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','owner')),
  is_founder INTEGER NOT NULL DEFAULT 0 CHECK (is_founder IN (0,1)),
  prediction_input_mode TEXT NOT NULL DEFAULT 'drag' CHECK (prediction_input_mode IN ('drag','sequential')),
  actual_input_mode TEXT NOT NULL DEFAULT 'sequential' CHECK (actual_input_mode IN ('drag','sequential')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_founder ON users(is_founder) WHERE is_founder=1;
CREATE TRIGGER founder_role_protected BEFORE UPDATE OF role,is_founder ON users
WHEN OLD.is_founder=1 AND (NEW.role<>'owner' OR NEW.is_founder<>1)
BEGIN SELECT RAISE(ABORT,'founder cannot be demoted'); END;
CREATE TRIGGER founder_cannot_delete BEFORE DELETE ON users WHEN OLD.is_founder=1
BEGIN SELECT RAISE(ABORT,'founder cannot be deleted'); END;

CREATE TABLE security_questions (
  id INTEGER PRIMARY KEY,
  question TEXT NOT NULL UNIQUE
);
CREATE TABLE user_security_answers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK(slot IN (1,2)),
  question_id INTEGER NOT NULL REFERENCES security_questions(id),
  answer_hash TEXT NOT NULL,
  PRIMARY KEY(user_id,slot),
  UNIQUE(user_id,question_id)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

-- 4-digit work code is a stable human-facing ID.  Serializations may repeat for a work.
CREATE TABLE works (
  id TEXT PRIMARY KEY CHECK (length(id)=4 AND id GLOB '[0-9][0-9][0-9][0-9]'),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  kind TEXT NOT NULL CHECK(kind IN ('serial','oneshot')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- YYYYNNMM: NN=issue start 01..55, MM=00 for a single or NN+1 for a combined issue.
CREATE TABLE serialization_periods (
  id INTEGER PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  start_issue_code TEXT NOT NULL CHECK(length(start_issue_code)=8),
  end_issue_code TEXT CHECK(end_issue_code IS NULL OR length(end_issue_code)=8),
  CHECK (end_issue_code IS NULL OR start_issue_code <= end_issue_code),
  UNIQUE(work_id,start_issue_code)
);
CREATE INDEX serializations_by_work ON serialization_periods(work_id,start_issue_code,end_issue_code);
CREATE TABLE oneshot_issues (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  issue_code TEXT NOT NULL CHECK(length(issue_code)=8),
  PRIMARY KEY(work_id,issue_code)
);
CREATE INDEX oneshots_by_issue ON oneshot_issues(issue_code);

CREATE TABLE issues (
  code TEXT PRIMARY KEY CHECK (
    length(code)=8 AND code GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    AND CAST(substr(code,5,2) AS INTEGER) BETWEEN 1 AND 55
    AND (substr(code,7,2)='00' OR
      CAST(substr(code,7,2) AS INTEGER)=CAST(substr(code,5,2) AS INTEGER)+1)
    AND CAST(substr(code,7,2) AS INTEGER)<=55
  ),
  release_at TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,
  cutoff_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK(cutoff_manually_edited IN (0,1)),
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','open','closed')),
  plan_reviewed_at TEXT,
  opened_at TEXT,
  closed_at TEXT,
  scores_confirmed_at TEXT,
  results_published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Only one issue may be accepting predictions.
CREATE UNIQUE INDEX one_open_issue ON issues(status) WHERE status='open';
CREATE INDEX issues_by_release ON issues(release_at);
-- For real published issue master, normal and combined issues may not overlap their issue numbers.
CREATE TRIGGER issue_no_overlapping_numbers_insert BEFORE INSERT ON issues
WHEN EXISTS (
  SELECT 1 FROM issues x WHERE substr(x.code,1,4)=substr(NEW.code,1,4)
  AND CAST(substr(x.code,5,2) AS INTEGER) <=
      CASE WHEN substr(NEW.code,7,2)='00' THEN CAST(substr(NEW.code,5,2) AS INTEGER)
           ELSE CAST(substr(NEW.code,7,2) AS INTEGER) END
  AND CAST(substr(NEW.code,5,2) AS INTEGER) <=
      CASE WHEN substr(x.code,7,2)='00' THEN CAST(substr(x.code,5,2) AS INTEGER)
           ELSE CAST(substr(x.code,7,2) AS INTEGER) END
) BEGIN SELECT RAISE(ABORT,'overlapping magazine issue numbers'); END;
CREATE TRIGGER issue_no_overlapping_numbers_update BEFORE UPDATE OF code ON issues
WHEN EXISTS (
  SELECT 1 FROM issues x WHERE x.code<>OLD.code AND substr(x.code,1,4)=substr(NEW.code,1,4)
  AND CAST(substr(x.code,5,2) AS INTEGER) <=
      CASE WHEN substr(NEW.code,7,2)='00' THEN CAST(substr(NEW.code,5,2) AS INTEGER)
           ELSE CAST(substr(NEW.code,7,2) AS INTEGER) END
  AND CAST(substr(NEW.code,5,2) AS INTEGER) <=
      CASE WHEN substr(x.code,7,2)='00' THEN CAST(substr(x.code,5,2) AS INTEGER)
           ELSE CAST(substr(x.code,7,2) AS INTEGER) END
) BEGIN SELECT RAISE(ABORT,'overlapping magazine issue numbers'); END;

-- Differences from automatic selection; defined prior to accepting predictions.
CREATE TABLE issue_work_overrides (
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  inclusion TEXT NOT NULL DEFAULT 'auto' CHECK(inclusion IN ('auto','include','exclude','planned_hiatus')),
  color TEXT NOT NULL DEFAULT 'none' CHECK(color IN ('none','lead','center')),
  PRIMARY KEY(issue_code,work_id)
);
CREATE UNIQUE INDEX one_lead_color_per_issue ON issue_work_overrides(issue_code) WHERE color='lead';
-- Immutable membership/color/order snapshot taken atomically at manual acceptance start.
CREATE TABLE issue_frozen_works (
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  initial_position INTEGER NOT NULL CHECK(initial_position > 0),
  color TEXT NOT NULL DEFAULT 'none' CHECK(color IN ('none','lead','center')),
  PRIMARY KEY(issue_code,work_id),
  UNIQUE(issue_code,initial_position)
);
CREATE TABLE issue_sudden_hiatus (
  issue_code TEXT NOT NULL,
  work_id TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  PRIMARY KEY(issue_code,work_id),
  FOREIGN KEY(issue_code,work_id) REFERENCES issue_frozen_works(issue_code,work_id) ON DELETE RESTRICT
);

-- Submitted predictions and drafts use separate storage to avoid accidental overwrite.
CREATE TABLE predictions (
  id TEXT PRIMARY KEY,
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  first_submitted_at TEXT NOT NULL,
  last_submitted_at TEXT NOT NULL,
  last_submitted_by TEXT REFERENCES users(id),
  UNIQUE(issue_code,user_id)
);
CREATE INDEX predictions_by_issue_first_submit ON predictions(issue_code,first_submitted_at);
CREATE TABLE prediction_items (
  prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  predicted_rank INTEGER NOT NULL CHECK(predicted_rank > 0),
  PRIMARY KEY(prediction_id,work_id),
  UNIQUE(prediction_id,predicted_rank)
);
CREATE TABLE prediction_drafts (
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_mode TEXT NOT NULL CHECK(input_mode IN ('drag','sequential')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(issue_code,user_id)
);
CREATE TABLE prediction_draft_items (
  issue_code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  selected_rank INTEGER NOT NULL CHECK(selected_rank>0),
  PRIMARY KEY(issue_code,user_id,work_id),
  UNIQUE(issue_code,user_id,selected_rank),
  FOREIGN KEY(issue_code,user_id) REFERENCES prediction_drafts(issue_code,user_id) ON DELETE CASCADE
);

-- Raw actual order includes unanticipated manga; scored order is obtained by filtering.
CREATE TABLE actual_order_draft_items (
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  actual_rank INTEGER NOT NULL CHECK(actual_rank>0),
  PRIMARY KEY(issue_code,work_id),
  UNIQUE(issue_code,actual_rank)
);
CREATE TABLE actual_order_items (
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  actual_rank INTEGER NOT NULL CHECK(actual_rank>0),
  PRIMARY KEY(issue_code,work_id),
  UNIQUE(issue_code,actual_rank)
);
CREATE TABLE issue_scores (
  issue_code TEXT NOT NULL REFERENCES issues(code) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_error INTEGER NOT NULL CHECK(total_error>=0),
  place INTEGER NOT NULL CHECK(place>=1),
  calculated_at TEXT NOT NULL,
  PRIMARY KEY(issue_code,user_id)
);
CREATE INDEX scores_issue_rank ON issue_scores(issue_code,place);

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  archived_at TEXT,
  announced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tournament_stages (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('qualifier','final')),
  finalists_announced_at TEXT,
  UNIQUE(tournament_id,kind)
);
CREATE TABLE stage_issues (
  stage_id TEXT NOT NULL REFERENCES tournament_stages(id) ON DELETE CASCADE,
  issue_code TEXT NOT NULL CHECK(length(issue_code)=8),
  PRIMARY KEY(stage_id,issue_code)
);
CREATE INDEX stage_issues_by_issue ON stage_issues(issue_code);
CREATE TABLE stage_participants (
  stage_id TEXT NOT NULL REFERENCES tournament_stages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TEXT NOT NULL,
  enrollment_source TEXT NOT NULL CHECK(enrollment_source IN ('self','admin','finalist_selection')),
  PRIMARY KEY(stage_id,user_id)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','hidden')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  important_notified_at TEXT,
  published_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('cutoff_reminder','inquiry','important_announcement')),
  source_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(user_id,kind,source_id)
);
CREATE INDEX notifications_by_user_created ON notifications(user_id,created_at DESC);
CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','done')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE inquiry_messages (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX inquiry_messages_by_thread ON inquiry_messages(inquiry_id,created_at);
CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  site_name TEXT NOT NULL,
  maintenance INTEGER NOT NULL DEFAULT 0 CHECK(maintenance IN (0,1)),
  maintenance_message TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
