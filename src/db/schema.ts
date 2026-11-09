import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

// Users table (using uid as text identifier, compatible with both custom username or Firebase UID)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID or Star Betting username
  email: text('email'),
  username: text('username').notNull(),
  password: text('password'), // password hash / plain text for legacy sign-in
  balance: integer('balance').notNull().default(30),
  referralCode: text('referral_code').notNull().unique(),
  referredBy: text('referred_by'),
  totalReferrals: integer('total_referrals').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Rounds table
export const rounds = pgTable('rounds', {
  id: serial('id').primaryKey(),
  roundNumber: integer('round_number').notNull().unique(),
  pot: integer('pot').notNull().default(0),
  roundEndTime: timestamp('round_end_time').notNull(),
  winningNumber: text('winning_number'),
  status: text('status').notNull().default('active'), // active, resolving, completed
  winnersJson: text('winners_json'), // JSON array of winners [{ userId, betNumber, payout }]
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Bets table
export const bets = pgTable('bets', {
  id: serial('id').primaryKey(),
  betId: text('bet_id').notNull().unique(),
  roundNumber: integer('round_number').notNull(),
  userId: text('user_id').notNull(),
  number: text('number').notNull(),
  digits: integer('digits').notNull(),
  cost: integer('cost').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Transactions table
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  txId: text('tx_id').notNull().unique(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(), // 'in', 'out', 'win', 'bonus'
  amount: integer('amount').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// System Stats table
export const systemStats = pgTable('system_stats', {
  id: serial('id').primaryKey(),
  houseProfit: integer('house_profit').notNull().default(0),
  totalBetsCount: integer('total_bets_count').notNull().default(0),
  totalBetsVolume: integer('total_bets_volume').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
