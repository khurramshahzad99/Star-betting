import { db } from './index.ts';
import { users, rounds, bets, transactions, systemStats } from './schema.ts';
import { eq, desc } from 'drizzle-orm';

const ROUND_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export async function seedInitialData() {
  try {
    // 1. Ensure master admin user kskhan37302@gmail.com exists in DB with code Khuram99
    // Ensure khuram_shahzad is synced as master admin
    const khuramUser = await db.select().from(users).where(eq(users.username, 'khuram_shahzad')).limit(1);
    if (khuramUser.length > 0) {
      await db.update(users).set({
        password: 'Khuram99',
        email: 'kskhan37302@gmail.com',
      }).where(eq(users.username, 'khuram_shahzad'));
    } else {
      await db.insert(users).values({
        uid: 'khuram_shahzad',
        username: 'khuram_shahzad',
        email: 'kskhan37302@gmail.com',
        password: 'Khuram99',
        balance: 10000,
        referralCode: 'STAR-TU03',
        totalReferrals: 0,
      });
    }

    const masterAdmin = await db.select().from(users).where(eq(users.uid, 'kskhan37302@gmail.com')).limit(1);
    if (masterAdmin.length === 0) {
      await db.insert(users).values({
        uid: 'kskhan37302@gmail.com',
        username: 'kskhan37302@gmail.com',
        email: 'kskhan37302@gmail.com',
        password: 'Khuram99',
        balance: 10000,
        referralCode: 'STAR-KHURAM',
        totalReferrals: 0,
      });
    } else {
      await db.update(users).set({
        password: 'Khuram99',
        email: 'kskhan37302@gmail.com',
      }).where(eq(users.uid, 'kskhan37302@gmail.com'));
    }

    // Ensure legacy admin alias also uses code Khuram99
    const legacyAdmin = await db.select().from(users).where(eq(users.uid, 'admin')).limit(1);
    if (legacyAdmin.length > 0) {
      await db.update(users).set({ password: 'Khuram99' }).where(eq(users.uid, 'admin'));
    } else {
      await db.insert(users).values({
        uid: 'admin',
        username: 'admin',
        password: 'Khuram99',
        balance: 10000,
        referralCode: 'STAR-BOSS',
        totalReferrals: 0,
      });
    }

    // Ensure sample community players exist
    const lisa = await db.select().from(users).where(eq(users.uid, 'lucky_lisa')).limit(1);
    if (lisa.length === 0) {
      await db.insert(users).values([
        {
          uid: 'lucky_lisa',
          username: 'lucky_lisa',
          password: 'password123',
          balance: 450,
          referralCode: 'STAR-LISA',
          totalReferrals: 2,
        },
        {
          uid: 'crypto_dan',
          username: 'crypto_dan',
          password: 'password123',
          balance: 820,
          referralCode: 'STAR-DAN7',
          totalReferrals: 1,
        }
      ]);

      await db.insert(transactions).values([
        {
          txId: 'tx-seed-1',
          userId: 'kskhan37302@gmail.com',
          type: 'bonus',
          amount: 10000,
          title: 'Initial Reserve',
          description: 'House liquidity allocation',
        },
        {
          txId: 'tx-seed-2',
          userId: 'lucky_lisa',
          type: 'bonus',
          amount: 30,
          title: 'Welcome Bonus',
          description: 'New player welcome reward',
        },
        {
          txId: 'tx-seed-3',
          userId: 'crypto_dan',
          type: 'bonus',
          amount: 30,
          title: 'Welcome Bonus',
          description: 'New player welcome reward',
        }
      ]);
    }

    // 2. Ensure initial stats exist
    const statsList = await db.select().from(systemStats).limit(1);
    if (statsList.length === 0) {
      await db.insert(systemStats).values({
        houseProfit: 1450,
        totalBetsCount: 28,
        totalBetsVolume: 4320,
      });
    }

    // 3. Ensure an active round exists
    const activeRound = await db.select().from(rounds).where(eq(rounds.status, 'active')).orderBy(desc(rounds.roundNumber)).limit(1);
    if (activeRound.length === 0) {
      const now = Date.now();
      await db.insert(rounds).values({
        roundNumber: 105,
        pot: 0,
        roundEndTime: new Date(now + ROUND_DURATION_MS),
        status: 'active',
      });
    }
  } catch (err) {
    console.error('Error during database initial seed:', err);
  }
}
