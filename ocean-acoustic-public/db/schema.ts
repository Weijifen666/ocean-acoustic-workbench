import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const requests=sqliteTable('bridge_requests',{
 id:text('id').primaryKey(),created:integer('created').notNull(),state:text('state').notNull(),payload:text('payload').notNull()
},t=>[index('bridge_requests_state_created').on(t.state,t.created)]);
export const heartbeat=sqliteTable('bridge_state',{id:text('id').primaryKey(),seen:integer('seen').notNull()});
export const visitors=sqliteTable('cloud_visitors',{
 id:text('id').primaryKey(),ciphertext:text('ciphertext').notNull(),version:integer('version').notNull().default(0),updated:integer('updated').notNull()
},t=>[index('cloud_visitors_updated').on(t.updated)]);

export const conversations=sqliteTable('cloud_conversations',{
 id:text('id').primaryKey(),visitor_id:text('visitor_id').notNull(),ciphertext:text('ciphertext').notNull(),
 created:integer('created').notNull(),updated:integer('updated').notNull(),migrated:integer('migrated').notNull().default(0)
},t=>[index('cloud_conversations_owner_updated').on(t.visitor_id,t.updated)]);
export const messages=sqliteTable('cloud_messages',{
 id:text('id').primaryKey(),visitor_id:text('visitor_id').notNull(),conversation_id:text('conversation_id').notNull(),
 run_id:text('run_id').notNull(),ordinal:integer('ordinal').notNull(),ciphertext:text('ciphertext').notNull(),created:integer('created').notNull()
},t=>[index('cloud_messages_conversation_created').on(t.visitor_id,t.conversation_id,t.created,t.ordinal),uniqueIndex('cloud_messages_run_ordinal').on(t.run_id,t.ordinal)]);
export const chatRuns=sqliteTable('cloud_chat_runs',{
 id:text('id').primaryKey(),visitor_id:text('visitor_id').notNull(),conversation_id:text('conversation_id').notNull(),
 request_key:text('request_key').notNull(),payload_hash:text('payload_hash').notNull(),state:text('state').notNull(),
 ciphertext:text('ciphertext'),created:integer('created').notNull(),updated:integer('updated').notNull()
},t=>[uniqueIndex('cloud_chat_runs_owner_request').on(t.visitor_id,t.request_key),index('cloud_chat_runs_owner_state').on(t.visitor_id,t.conversation_id,t.state,t.updated)]);

// Shared research notes only. Model profiles and private attachments stay out.
export const workspaces=sqliteTable('research_workspaces',{
 id:text('id').primaryKey(),owner_id:text('owner_id').notNull(),ciphertext:text('ciphertext').notNull(),
 created:integer('created').notNull(),updated:integer('updated').notNull()
},t=>[index('research_workspaces_owner_created').on(t.owner_id,t.created)]);
export const workspaceMembers=sqliteTable('research_workspace_members',{
 id:text('id').primaryKey(),workspace_id:text('workspace_id').notNull(),account_id:text('account_id').notNull(),role:text('role').notNull(),
 ciphertext:text('ciphertext').notNull(),joined_via_invite:text('joined_via_invite'),joined:integer('joined').notNull()
},t=>[uniqueIndex('research_members_workspace_account').on(t.workspace_id,t.account_id),index('research_members_account_joined').on(t.account_id,t.joined)]);
export const workspaceInvites=sqliteTable('research_workspace_invites',{
 id:text('id').primaryKey(),workspace_id:text('workspace_id').notNull(),creator_id:text('creator_id').notNull(),token_hash:text('token_hash').notNull(),
 created:integer('created').notNull(),expires:integer('expires').notNull(),revoked:integer('revoked').notNull().default(0),
 used_by:text('used_by'),used_at:integer('used_at')
},t=>[uniqueIndex('research_invites_token_hash').on(t.token_hash),index('research_invites_workspace_created').on(t.workspace_id,t.created)]);
export const workspaceArtifacts=sqliteTable('research_workspace_artifacts',{
 id:text('id').primaryKey(),workspace_id:text('workspace_id').notNull(),author_id:text('author_id').notNull(),ciphertext:text('ciphertext').notNull(),
 created:integer('created').notNull(),updated:integer('updated').notNull()
},t=>[index('research_artifacts_workspace_created').on(t.workspace_id,t.created)]);
