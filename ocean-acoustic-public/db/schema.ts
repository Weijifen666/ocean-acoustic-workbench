import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const requests=sqliteTable('bridge_requests',{
 id:text('id').primaryKey(),created:integer('created').notNull(),state:text('state').notNull(),payload:text('payload').notNull()
},t=>[index('bridge_requests_state_created').on(t.state,t.created)]);
export const heartbeat=sqliteTable('bridge_state',{id:text('id').primaryKey(),seen:integer('seen').notNull()});
