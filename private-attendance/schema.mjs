export const schemaSQL = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY,label TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,location TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity=20),status TEXT NOT NULL,owner_expected INTEGER NOT NULL,
 revision INTEGER NOT NULL,observed_at TEXT NOT NULL,snapshot_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
 approved INTEGER NOT NULL CHECK(approved IN(0,1)),complete INTEGER NOT NULL CHECK(complete IN(0,1)));
CREATE TABLE IF NOT EXISTS roster (
 session_id TEXT NOT NULL REFERENCES sessions(id),player_id TEXT NOT NULL,family_id TEXT NOT NULL,
 attendance_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,guardian_name TEXT,email_verified INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('dropin','pass','camp')),reserved INTEGER NOT NULL,eligible INTEGER NOT NULL,
 reminder_preference TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(session_id,player_id));
CREATE TABLE IF NOT EXISTS responses (
 session_id TEXT NOT NULL,player_id TEXT NOT NULL,response TEXT NOT NULL CHECK(response IN('yes','no')),
 version INTEGER NOT NULL CHECK(version>0),updated_at TEXT NOT NULL,
 PRIMARY KEY(session_id,player_id),FOREIGN KEY(session_id,player_id) REFERENCES roster(session_id,player_id));
CREATE TABLE IF NOT EXISTS invitations (
 token_hash TEXT PRIMARY KEY,purpose TEXT NOT NULL CHECK(purpose IN('rsvp','optout')),session_id TEXT NOT NULL,
 player_id TEXT NOT NULL,expires_at TEXT NOT NULL,issued_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(session_id,player_id) REFERENCES roster(session_id,player_id));
CREATE INDEX IF NOT EXISTS invitation_subject ON invitations(session_id,player_id,purpose,revoked);
CREATE TABLE IF NOT EXISTS challenges (
 challenge_hash TEXT PRIMARY KEY,token_hash TEXT NOT NULL REFERENCES invitations(token_hash),csrf_hash TEXT NOT NULL,
 action TEXT NOT NULL,answer TEXT,expected_version INTEGER NOT NULL,expires_at TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests (
 token_hash TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,
 PRIMARY KEY(token_hash,idempotency_key));
CREATE TABLE IF NOT EXISTS preferences (
 family_id TEXT NOT NULL,player_id TEXT NOT NULL,weekly_enabled INTEGER NOT NULL CHECK(weekly_enabled IN(0,1)),
 updated_at TEXT NOT NULL,PRIMARY KEY(family_id,player_id));
CREATE TABLE IF NOT EXISTS roster_metadata (
 attendance_id TEXT PRIMARY KEY,physical_attendance TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS preference_deliveries (
 event_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',last_error TEXT);
CREATE TABLE IF NOT EXISTS response_events (
 event_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,player_id TEXT NOT NULL,attendance_id TEXT NOT NULL,
 previous_response TEXT,response TEXT NOT NULL,version INTEGER NOT NULL,occurred_at TEXT NOT NULL,
 roster_revision INTEGER NOT NULL,source TEXT NOT NULL CHECK(source='custom-email-rsvp'),
 UNIQUE(session_id,player_id,version));
CREATE TABLE IF NOT EXISTS preference_events (
 event_id TEXT PRIMARY KEY,family_id TEXT NOT NULL,player_id TEXT NOT NULL,session_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='weekly-optout'),occurred_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
 event_id TEXT PRIMARY KEY REFERENCES response_events(event_id),session_id TEXT NOT NULL,player_id TEXT NOT NULL,
 attendance_id TEXT NOT NULL,response TEXT NOT NULL,version INTEGER NOT NULL,occurred_at TEXT NOT NULL,
 payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);
`;
export function initializeStore(store){store.run(schemaSQL);return store;}
