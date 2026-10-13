-- Store explicit admin save of the finalist list separately from the public announcement.
-- A draft selection cannot be announced until it has been saved.
ALTER TABLE tournament_stages ADD COLUMN finalists_saved_at TEXT;
