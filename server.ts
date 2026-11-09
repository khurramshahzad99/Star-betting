import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.ts';
import { users, rounds, bets, transactions, systemStats } from './src/db/schema.ts';
import { eq, desc, and } from 'drizzle-orm';
import { seedInitialData } from './src/db/seed.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;
const ROUND_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Bet pricing map
const DIGIT_COSTS: Record<number, number> = {
  1: 10,
  2: 30,
  3: 50,
  4: 100,
  5: 500,
  6: 1000,
};

// Seed DB on start
seedInitialData().catch(console.error);

// Helper: Ensure round check and resolution
async function getOrCreateActiveRound() {
  const activeList = await db.select().from(rounds).where(eq(rounds.status, 'active')).orderBy(desc(rounds.roundNumber)).limit(1);
  if (activeList.length > 0) {
    const current = activeList[0];
    const now = Date.now();
    // Check if expired
    if (new Date(current.roundEndTime).getTime() <= now) {
      return await resolveCurrentRound(current.roundNumber);
    }
    return current;
  }

  // Create new round if none active
  const lastRound = await db.select().from(rounds).orderBy(desc(rounds.roundNumber)).limit(1);
  const nextNum = (lastRound[0]?.roundNumber || 100) + 1;
  const [newRound] = await db.insert(rounds).values({
    roundNumber: nextNum,
    pot: 0,
    roundEndTime: new Date(Date.now() + ROUND_DURATION_MS),
    status: 'active',
  }).returning();

  return newRound;
}

// Function to resolve round
async function resolveCurrentRound(roundNumber: number) {
  const [round] = await db.select().from(rounds).where(eq(rounds.roundNumber, roundNumber)).limit(1);
  if (!round || round.status === 'completed') {
    const active = await db.select().from(rounds).where(eq(rounds.status, 'active')).orderBy(desc(rounds.roundNumber)).limit(1);
    return active[0];
  }

  // Generate 6 digit winning number
  const generatedInt = Math.floor(Math.random() * 1000000);
  const winningNumber = generatedInt.toString().padStart(6, '0');

  // Fetch all bets in this round
  const roundBets = await db.select().from(bets).where(eq(bets.roundNumber, roundNumber));
  const winningBets: typeof roundBets = [];

  for (const b of roundBets) {
    const suffix = winningNumber.slice(-b.digits);
    if (b.number === suffix) {
      winningBets.push(b);
    }
  }

  const pot = round.pot;
  const winners: Array<{ userId: string; betNumber: string; payout: number }> = [];

  if (winningBets.length > 0 && pot > 0) {
    const payoutPerWinner = Math.floor(pot / winningBets.length);
    for (const wBet of winningBets) {
      winners.push({
        userId: wBet.userId,
        betNumber: wBet.number,
        payout: payoutPerWinner,
      });

      // Update user balance
      const [u] = await db.select().from(users).where(eq(users.uid, wBet.userId)).limit(1);
      if (u) {
        await db.update(users).set({ balance: u.balance + payoutPerWinner }).where(eq(users.uid, wBet.userId));
      }

      // Add 'win' transaction
      await db.insert(transactions).values({
        txId: `tx-win-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        userId: wBet.userId,
        type: 'win',
        amount: payoutPerWinner,
        title: `Round #${roundNumber} Jackpot!`,
        description: `Hit number ${wBet.number} (Pot split: ${payoutPerWinner} units)`,
      });
    }
  } else if (pot > 0) {
    // House retains unhit pot
    const [stats] = await db.select().from(systemStats).limit(1);
    if (stats) {
      await db.update(systemStats).set({
        houseProfit: stats.houseProfit + pot,
        updatedAt: new Date(),
      }).where(eq(systemStats.id, stats.id));
    }
  }

  // Mark round completed
  await db.update(rounds).set({
    status: 'completed',
    winningNumber,
    winnersJson: JSON.stringify(winners),
  }).where(eq(rounds.roundNumber, roundNumber));

  // Auto-start next round
  const nextRoundNumber = roundNumber + 1;
  const [nextRound] = await db.insert(rounds).values({
    roundNumber: nextRoundNumber,
    pot: 0,
    roundEndTime: new Date(Date.now() + ROUND_DURATION_MS),
    status: 'active',
  }).returning();

  return nextRound;
}

// Background checker loop for timer resolution
setInterval(async () => {
  try {
    const active = await db.select().from(rounds).where(eq(rounds.status, 'active')).orderBy(desc(rounds.roundNumber)).limit(1);
    if (active.length > 0) {
      const r = active[0];
      if (new Date(r.roundEndTime).getTime() <= Date.now()) {
        await resolveCurrentRound(r.roundNumber);
      }
    }
  } catch (err: any) {
    // Gracefully ignore transient proxy reconnects
    if (!err?.message?.includes('Connection terminated') && !err?.message?.includes('ENOENT')) {
      console.warn('Background timer notice:', err?.message || err);
    }
  }
}, 4000);

// --- API ROUTES ---

// 1. Get current round & live bets
app.get('/api/round/current', async (req, res) => {
  try {
    const currentRound = await getOrCreateActiveRound();
    const currentBets = await db.select().from(bets).where(eq(bets.roundNumber, currentRound.roundNumber)).orderBy(desc(bets.createdAt));
    const recentCompleted = await db.select().from(rounds).where(eq(rounds.status, 'completed')).orderBy(desc(rounds.roundNumber)).limit(10);

    const historyFormatted = recentCompleted.map(rc => ({
      id: `round-${rc.roundNumber}`,
      roundNumber: rc.roundNumber,
      winningNumber: rc.winningNumber || '000000',
      pot: rc.pot,
      totalBets: 0,
      winners: rc.winnersJson ? JSON.parse(rc.winnersJson) : [],
      timestamp: new Date(rc.createdAt).getTime(),
    }));

    res.json({
      round: {
        roundNumber: currentRound.roundNumber,
        pot: currentRound.pot,
        roundEndTime: new Date(currentRound.roundEndTime).getTime(),
        status: currentRound.status,
      },
      bets: currentBets.map(b => ({
        id: b.betId,
        userId: b.userId,
        number: b.number,
        digits: b.digits,
        cost: b.cost,
        roundNumber: b.roundNumber,
        timestamp: new Date(b.createdAt).getTime(),
      })),
      history: historyFormatted,
    });
  } catch (err: any) {
    console.error('Failed to get round info:', err);
    res.status(500).json({ error: 'Failed to fetch current round' });
  }
});

// 2. User login / profile fetch
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const [user] = await db.select().from(users).where(eq(users.username, username.trim())).limit(1);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Use admin / admin123 or sign up.' });
    }

    if (password && user.password && user.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    res.json({
      user: {
        id: user.uid,
        username: user.username,
        balance: user.balance,
        referralCode: user.referralCode,
        totalReferrals: user.totalReferrals,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// 3. User Signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password, referralCode } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const cleanName = username.trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.username, cleanName)).limit(1);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Check referral
    let referrerUser = null;
    if (referralCode) {
      const [ref] = await db.select().from(users).where(eq(users.referralCode, referralCode.trim().toUpperCase())).limit(1);
      if (ref) referrerUser = ref;
    }

    const myRefCode = 'STAR-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    const [newUser] = await db.insert(users).values({
      uid: cleanName,
      username: cleanName,
      password,
      balance: 30, // 30 units welcome bonus
      referralCode: myRefCode,
      referredBy: referrerUser ? referrerUser.uid : null,
      totalReferrals: 0,
    }).returning();

    // Welcome bonus transaction
    await db.insert(transactions).values({
      txId: `tx-welcome-${Date.now()}`,
      userId: cleanName,
      type: 'bonus',
      amount: 30,
      title: 'Welcome Bonus',
      description: '30 units welcome reward upon registration',
    });

    // Credit referrer if exists
    if (referrerUser) {
      await db.update(users).set({
        balance: referrerUser.balance + 30,
        totalReferrals: referrerUser.totalReferrals + 1,
      }).where(eq(users.id, referrerUser.id));

      await db.insert(transactions).values({
        txId: `tx-ref-${Date.now()}`,
        userId: referrerUser.uid,
        type: 'bonus',
        amount: 30,
        title: 'Referral Reward',
        description: `Referral reward for inviting @${cleanName} (+30 units)`,
      });
    }

    res.json({
      user: {
        id: newUser.uid,
        username: newUser.username,
        balance: newUser.balance,
        referralCode: newUser.referralCode,
        totalReferrals: newUser.totalReferrals,
      }
    });
  } catch (err: any) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// 4. Place Bet
app.post('/api/bet/place', async (req, res) => {
  try {
    const { userId, number, digits } = req.body;
    if (!userId || !number || !digits) {
      return res.status(400).json({ error: 'Invalid bet parameters' });
    }

    const cost = DIGIT_COSTS[Number(digits)];
    if (!cost) return res.status(400).json({ error: 'Invalid digit tier' });

    const [user] = await db.select().from(users).where(eq(users.uid, userId)).limit(1);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.balance < cost) return res.status(400).json({ error: 'Insufficient balance' });

    const currentRound = await getOrCreateActiveRound();

    // Deduct user balance
    await db.update(users).set({ balance: user.balance - cost }).where(eq(users.uid, userId));

    // Increase round pot
    await db.update(rounds).set({ pot: currentRound.pot + cost }).where(eq(rounds.id, currentRound.id));

    // Insert bet
    const betId = `bet-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await db.insert(bets).values({
      betId,
      roundNumber: currentRound.roundNumber,
      userId,
      number: String(number),
      digits: Number(digits),
      cost,
    });

    // Record 'out' transaction
    await db.insert(transactions).values({
      txId: `tx-bet-${Date.now()}`,
      userId,
      type: 'out',
      amount: cost,
      title: `Bet Placed (#${number})`,
      description: `${digits}-digit bet in Round #${currentRound.roundNumber}`,
    });

    // Update system stats
    const [stats] = await db.select().from(systemStats).limit(1);
    if (stats) {
      await db.update(systemStats).set({
        totalBetsCount: stats.totalBetsCount + 1,
        totalBetsVolume: stats.totalBetsVolume + cost,
        updatedAt: new Date(),
      }).where(eq(systemStats.id, stats.id));
    }

    res.json({
      success: true,
      newBalance: user.balance - cost,
      betId,
    });
  } catch (err: any) {
    console.error('Bet error:', err);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// 5. User-to-User Transfer
app.post('/api/wallet/transfer', async (req, res) => {
  try {
    const { fromUserId, toUserId, amount } = req.body;
    const numAmount = parseInt(amount, 10);
    if (!fromUserId || !toUserId || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Invalid transfer details' });
    }

    if (fromUserId.toLowerCase() === toUserId.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

    const [sender] = await db.select().from(users).where(eq(users.uid, fromUserId)).limit(1);
    const [recipient] = await db.select().from(users).where(eq(users.uid, toUserId.toLowerCase().trim())).limit(1);

    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    if (!recipient) return res.status(404).json({ error: `User @${toUserId} not found` });
    if (sender.balance < numAmount) return res.status(400).json({ error: 'Insufficient balance' });

    // Deduct sender, credit recipient
    await db.update(users).set({ balance: sender.balance - numAmount }).where(eq(users.uid, sender.uid));
    await db.update(users).set({ balance: recipient.balance + numAmount }).where(eq(users.uid, recipient.uid));

    // Transactions
    await db.insert(transactions).values([
      {
        txId: `tx-out-${Date.now()}`,
        userId: sender.uid,
        type: 'out',
        amount: numAmount,
        title: `Transfer to @${recipient.username}`,
        description: `Sent units to user @${recipient.username}`,
      },
      {
        txId: `tx-in-${Date.now()}`,
        userId: recipient.uid,
        type: 'in',
        amount: numAmount,
        title: `Transfer from @${sender.username}`,
        description: `Received units from user @${sender.username}`,
      }
    ]);

    res.json({
      success: true,
      newBalance: sender.balance - numAmount,
    });
  } catch (err: any) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Transfer failed' });
  }
});

// 6. User Transactions
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const userTxs = await db.select().from(transactions).where(eq(transactions.userId, req.params.userId)).orderBy(desc(transactions.createdAt)).limit(50);
    res.json(userTxs.map(t => ({
      id: t.txId,
      userId: t.userId,
      type: t.type,
      amount: t.amount,
      title: t.title,
      description: t.description,
      timestamp: new Date(t.createdAt).getTime(),
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// 7. Admin Metrics & Tools
app.get('/api/admin/metrics', async (req, res) => {
  try {
    const [stats] = await db.select().from(systemStats).limit(1);
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    const totalSystemBalance = allUsers.reduce((sum, u) => sum + u.balance, 0);

    res.json({
      systemBalance: totalSystemBalance,
      houseProfit: stats?.houseProfit || 0,
      totalUsers: allUsers.length,
      totalBetsCount: stats?.totalBetsCount || 0,
      totalBetsVolume: stats?.totalBetsVolume || 0,
      users: allUsers.map(u => ({
        id: u.uid,
        username: u.username,
        balance: u.balance,
        referralCode: u.referralCode,
        totalReferrals: u.totalReferrals,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin metrics' });
  }
});

// 8. Admin Force Draw
app.post('/api/admin/force-draw', async (req, res) => {
  try {
    const active = await db.select().from(rounds).where(eq(rounds.status, 'active')).orderBy(desc(rounds.roundNumber)).limit(1);
    if (active.length > 0) {
      const next = await resolveCurrentRound(active[0].roundNumber);
      return res.json({ success: true, nextRoundNumber: next.roundNumber });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to force draw' });
  }
});

// 9. Admin Add Liquidity
app.post('/api/admin/add-liquidity', async (req, res) => {
  try {
    const { userId } = req.body || {};
    const targetUid = userId || 'kskhan37302@gmail.com';
    const [admin] = await db.select().from(users).where(eq(users.uid, targetUid)).limit(1);
    if (admin) {
      await db.update(users).set({ balance: admin.balance + 1000 }).where(eq(users.uid, targetUid));
      return res.json({ success: true, newBalance: admin.balance + 1000 });
    }
    // Fallback to admin username
    const [legacy] = await db.select().from(users).where(eq(users.uid, 'admin')).limit(1);
    if (legacy) {
      await db.update(users).set({ balance: legacy.balance + 1000 }).where(eq(users.uid, 'admin'));
      return res.json({ success: true, newBalance: legacy.balance + 1000 });
    }
    res.status(404).json({ error: 'Admin user not found' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add liquidity' });
  }
});

// Mount Vite middleware for SPA
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
