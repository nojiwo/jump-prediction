-- Appearance preferences; apply after 001_initial.sql once.
ALTER TABLE users ADD COLUMN theme_mode TEXT NOT NULL DEFAULT 'system'
  CHECK (theme_mode IN ('system','light','dark'));
ALTER TABLE users ADD COLUMN accent_color TEXT NOT NULL DEFAULT 'cyan'
  CHECK (accent_color IN ('cyan','blue','green','purple','orange','pink'));
INSERT OR IGNORE INTO security_questions(id,question) VALUES
  (1,'初めて飼ったペットの名前は？'),
  (2,'子どもの頃に好きだった食べ物は？'),
  (3,'思い出のある街の名前は？'),
  (4,'好きだった本の題名は？'),
  (5,'初めて通った学校の通称は？'),
  (6,'自分で決めた秘密の合言葉は？');
