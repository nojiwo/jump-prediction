"""Run using python3 tests/db_test.py; sqlite3 exercises the same base SQLite constraints."""
import sqlite3
from pathlib import Path

root=Path(__file__).resolve().parents[1]
con=sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys = ON')
for migration in ('001_initial.sql','002_appearance.sql','003_final_selection.sql'):
    con.executescript((root/'migrations'/migration).read_text())
assert len(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()) >= 20
now='2026-10-11T00:00:00Z'

def add_issue(code,status='planned'):
    con.execute('INSERT INTO issues (code,release_at,cutoff_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
                (code,now,now,status,now,now))
def expect_integrity(fn):
    try: fn()
    except sqlite3.IntegrityError: return
    raise AssertionError('constraint unexpectedly accepted invalid data')

add_issue('20260203'); add_issue('20260400')
expect_integrity(lambda:add_issue('20260200'))
expect_integrity(lambda:add_issue('20260300'))
expect_integrity(lambda:add_issue('20260203'))
expect_integrity(lambda:add_issue('20260405'))
add_issue('20264000','open')
expect_integrity(lambda:add_issue('20264100','open'))
# Work may specify an as-yet-unregistered issue; its validity is verified before acceptance opens.
con.execute('INSERT INTO works VALUES (?,?,?,?,?)',('0001','作品A','serial',now,now))
con.execute('INSERT INTO works VALUES (?,?,?,?,?)',('0002','読み切りB','oneshot',now,now))
con.execute('INSERT INTO serialization_periods(work_id,start_issue_code,end_issue_code) VALUES (?,?,?)',('0001','20265000',None))
con.execute('INSERT INTO oneshot_issues VALUES (?,?)',('0002','20265051'))
expect_integrity(lambda:con.execute('INSERT INTO works VALUES (?,?,?,?,?)',('abc','不正','serial',now,now)))
con.execute('INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)',('u1','UserA','hash',now,now))
expect_integrity(lambda:con.execute('INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)',('u2','usera','hash',now,now)))
con.execute('INSERT INTO users(id,username,password_hash,role,is_founder,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',('founder','Founder','hash','owner',1,now,now))
expect_integrity(lambda:con.execute("UPDATE users SET role='user' WHERE id='founder'"))
con.execute("INSERT INTO issue_work_overrides(issue_code,work_id,color) VALUES (?,?,?)",('20264000','0001','lead'))
expect_integrity(lambda:con.execute("INSERT INTO issue_work_overrides(issue_code,work_id,color) VALUES (?,?,?)",('20264000','0002','lead')))
assert 'finalists_saved_at' in [r[1] for r in con.execute('PRAGMA table_info(tournament_stages)').fetchall()]
print('PASS: schema loads; overlap, one active issue, IDs, founder, finalist-save and color constraints enforced')
