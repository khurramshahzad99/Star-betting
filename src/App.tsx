/**
 * Star Betting - Mobile Number Betting App
 * Theme: Background #2f2f2f, Primary #4CAF50, Secondary #00ffff
 * Font: Pacifico
 * Icons: Remix Icons
 * Database: PostgreSQL Cloud SQL (asia-southeast1) + Server-authoritative multiplayer
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { auth, googleAuthProvider } from './lib/firebase.ts';
import { signInWithPopup } from 'firebase/auth';

// --- Types & Interfaces ---
export type TxType = 'in' | 'out' | 'win' | 'bonus';

export interface Transaction {
  id: string;
  userId: string;
  type: TxType;
  amount: number;
  title: string;
  description: string;
  timestamp: number;
}

export interface User {
  id: string;
  username: string;
  balance: number;
  referralCode: string;
  totalReferrals: number;
}

export interface Bet {
  id: string;
  userId: string;
  number: string;
  digits: number;
  cost: number;
  roundNumber: number;
  timestamp: number;
}

export interface RoundWinner {
  userId: string;
  betNumber: string;
  payout: number;
}

export interface CompletedRound {
  id?: string;
  roundNumber: number;
  winningNumber: string;
  pot: number;
  totalBets: number;
  winners: RoundWinner[];
  timestamp: number;
}

export interface ActiveRound {
  roundNumber: number;
  pot: number;
  bets: Bet[];
  roundEndTime: number; // unix timestamp ms
  status?: string;
}

export interface HouseStats {
  houseProfit: number;
  totalBetsCount: number;
  totalBetsVolume: number;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'win';
}

// Bet cost scale specification
export const DIGIT_COSTS: Record<number, number> = {
  1: 10,
  2: 30,
  3: 50,
  4: 100,
  5: 500,
  6: 1000,
};

const ROUND_DURATION_MS = 5 * 60 * 1000;
const SESSION_USER_KEY = 'star_betting_active_user';

export default function App() {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = sessionStorage.getItem(SESSION_USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  // Master Admin verification (Supports @khuram_shahzad, email kskhan37302@gmail.com, and admin)
  const isAdmin = 
    currentUser?.id === 'khuram_shahzad' || 
    currentUser?.username === 'khuram_shahzad' || 
    currentUser?.id === 'kskhan37302@gmail.com' || 
    currentUser?.username === 'kskhan37302@gmail.com' || 
    currentUser?.id === 'admin';

  const [authTab, setAuthTab] = useState<'login' | 'signup'>('login');
  const [authId, setAuthId] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authReferralCode, setAuthReferralCode] = useState('');

  // --- Navigation Tab ---
  const [activeTab, setActiveTab] = useState<'home' | 'bet' | 'wallet' | 'profile' | 'admin'>('home');

  // --- Active Round & Countdown State ---
  const [activeRound, setActiveRound] = useState<ActiveRound>({
    roundNumber: 104,
    pot: 0,
    bets: [],
    roundEndTime: Date.now() + ROUND_DURATION_MS,
  });

  const [timeLeftMs, setTimeLeftMs] = useState<number>(ROUND_DURATION_MS);

  // Reveal / Announcement Phase (5 seconds)
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealData, setRevealData] = useState<{
    roundNumber: number;
    winningNumber: string;
    winners: RoundWinner[];
    pot: number;
  } | null>(null);

  // Past rounds history
  const [roundHistory, setRoundHistory] = useState<CompletedRound[]>([]);

  // House Stats
  const [houseStats, setHouseStats] = useState<HouseStats>({
    houseProfit: 0,
    totalBetsCount: 0,
    totalBetsVolume: 0,
  });
  const [totalSystemBalance, setTotalSystemBalance] = useState<number>(0);
  const [totalRegisteredUsers, setTotalRegisteredUsers] = useState<number>(0);
  const [adminUsersList, setAdminUsersList] = useState<any[]>([]);

  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Helper to persist session
  const saveUserSession = (user: User | null) => {
    if (user) {
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(SESSION_USER_KEY);
    }
    setCurrentUser(user);
  };

  // --- Real-time Polling for Cloud SQL Multi-player State ---
  const lastRoundNumberRef = useRef<number>(activeRound.roundNumber);

  const fetchCurrentRound = async () => {
    try {
      const res = await fetch('/api/round/current');
      if (!res.ok) return;
      const data = await res.json();

      if (data.round) {
        // Detect round transition
        if (data.round.roundNumber > lastRoundNumberRef.current && data.history.length > 0) {
          const finishedRound = data.history[0];
          // Trigger reveal overlay
          setRevealData({
            roundNumber: finishedRound.roundNumber,
            winningNumber: finishedRound.winningNumber,
            winners: finishedRound.winners,
            pot: finishedRound.pot,
          });
          setIsRevealing(true);

          if (currentUser) {
            const won = finishedRound.winners?.find((w: any) => w.userId === currentUser.id);
            if (won) {
              showToast(`🎉 WINNER! You won ${won.payout} units in Round #${finishedRound.roundNumber}!`, 'win');
              try {
                confetti({
                  particleCount: 80,
                  spread: 70,
                  origin: { y: 0.6 },
                  colors: ['#4CAF50', '#00ffff', '#ffd700', '#ffffff'],
                });
              } catch {}
            }
          }

          setTimeout(() => {
            setIsRevealing(false);
            setRevealData(null);
          }, 5000);
        }

        lastRoundNumberRef.current = data.round.roundNumber;

        setActiveRound({
          roundNumber: data.round.roundNumber,
          pot: data.round.pot,
          bets: data.bets || [],
          roundEndTime: data.round.roundEndTime,
          status: data.round.status,
        });

        if (data.history) {
          setRoundHistory(data.history);
        }
      }
    } catch (err) {
      // Background poll failure non-fatal
    }
  };

  const fetchUserTransactions = async (userId: string) => {
    try {
      const res = await fetch(`/api/transactions/${userId}`);
      if (res.ok) {
        const txs = await res.json();
        setTransactions(txs);
      }
    } catch {}
  };

  const fetchAdminMetrics = async () => {
    try {
      const res = await fetch('/api/admin/metrics');
      if (res.ok) {
        const data = await res.json();
        setTotalSystemBalance(data.systemBalance);
        setHouseStats({
          houseProfit: data.houseProfit,
          totalBetsCount: data.totalBetsCount,
          totalBetsVolume: data.totalBetsVolume,
        });
        setTotalRegisteredUsers(data.totalUsers);
        setAdminUsersList(data.users || []);
      }
    } catch {}
  };

  // Poll server state every 2.5 seconds
  useEffect(() => {
    fetchCurrentRound();
    const roundInterval = setInterval(fetchCurrentRound, 2500);
    return () => clearInterval(roundInterval);
  }, []);

  // Poll user data & transactions
  useEffect(() => {
    if (currentUser?.id) {
      fetchUserTransactions(currentUser.id);
      const userInterval = setInterval(() => {
        fetchUserTransactions(currentUser.id);
      }, 4000);
      return () => clearInterval(userInterval);
    }
  }, [currentUser?.id]);

  // Poll admin metrics if admin
  useEffect(() => {
    if (isAdmin) {
      fetchAdminMetrics();
      const adminInterval = setInterval(fetchAdminMetrics, 4000);
      return () => clearInterval(adminInterval);
    }
  }, [isAdmin, activeTab]);

  // Smooth Countdown Timer
  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = activeRound.roundEndTime - Date.now();
      setTimeLeftMs(Math.max(0, remaining));
    }, 500);
    return () => clearInterval(timer);
  }, [activeRound.roundEndTime]);

  // --- Auth Handlers ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = authId.trim();
    const pw = authPassword.trim();
    if (!id || !pw) {
      showToast('Please enter ID and password.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: id, password: pw }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Login failed', 'error');
        return;
      }
      saveUserSession(data.user);
      showToast(`Welcome back, @${data.user.username}!`, 'success');
      setAuthId('');
      setAuthPassword('');
    } catch {
      showToast('Network error while signing in', 'error');
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = authId.trim();
    const pw = authPassword.trim();
    const refCode = authReferralCode.trim().toUpperCase();

    if (!id || !pw) {
      showToast('Please enter username and password.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: id, password: pw, referralCode: refCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Signup failed', 'error');
        return;
      }
      saveUserSession(data.user);
      showToast(`Account created! +30 units welcome bonus credited!`, 'success');
      setAuthId('');
      setAuthPassword('');
      setAuthReferralCode('');
    } catch {
      showToast('Network error while creating account', 'error');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const user = cred.user;
      const email = user.email || '';
      const username = (user.displayName || email.split('@')[0] || 'player').toLowerCase().replace(/\s+/g, '_');

      // Login or register with Google UID
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (res.ok) {
        const data = await res.json();
        saveUserSession(data.user);
        showToast(`Signed in with Google as @${data.user.username}`, 'success');
      } else {
        // Auto signup
        const signupRes = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: 'google-oauth-user' }),
        });
        const signupData = await signupRes.json();
        if (signupRes.ok) {
          saveUserSession(signupData.user);
          showToast(`Welcome to Star Betting, @${signupData.user.username}! +30 units bonus!`, 'success');
        } else {
          showToast(signupData.error || 'Google login failed', 'error');
        }
      }
    } catch (err: any) {
      showToast('Google Sign-In canceled or unavailable.', 'error');
    }
  };

  const handleLogout = () => {
    saveUserSession(null);
    setActiveTab('home');
    showToast('Logged out successfully.', 'info');
  };

  const handleQuickAdminLogin = async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      const data = await res.json();
      if (res.ok) {
        saveUserSession(data.user);
        showToast('Switched to Admin account (admin)', 'success');
      }
    } catch {}
  };

  // --- Betting Handlers ---
  const [selectedDigits, setSelectedDigits] = useState<number>(2);
  const [betNumberInput, setBetNumberInput] = useState<string>('77');

  const handleDigitSelect = (digits: number) => {
    setSelectedDigits(digits);
    let current = betNumberInput.replace(/\D/g, '');
    if (current.length === 0) {
      current = '7'.repeat(digits);
    } else if (current.length < digits) {
      current = current.padEnd(digits, '0');
    } else {
      current = current.slice(0, digits);
    }
    setBetNumberInput(current);
  };

  const handleKeypadPress = (val: string) => {
    if (val === 'CLEAR') {
      setBetNumberInput('');
      return;
    }
    if (val === 'BACK') {
      setBetNumberInput(prev => prev.slice(0, -1));
      return;
    }
    if (betNumberInput.length < selectedDigits) {
      setBetNumberInput(prev => prev + val);
    }
  };

  const handleRandomizeNumber = () => {
    let rand = '';
    for (let i = 0; i < selectedDigits; i++) {
      rand += Math.floor(Math.random() * 10).toString();
    }
    setBetNumberInput(rand);
  };

  const handlePlaceBet = async () => {
    if (!currentUser) {
      showToast('Please sign in to place a bet.', 'error');
      return;
    }

    const cleanNum = betNumberInput.replace(/\D/g, '');
    if (cleanNum.length !== selectedDigits) {
      showToast(`Please enter exactly ${selectedDigits} digits.`, 'error');
      return;
    }

    const cost = DIGIT_COSTS[selectedDigits];
    if (currentUser.balance < cost) {
      showToast(`Insufficient balance! This ${selectedDigits}-digit bet costs ${cost} units.`, 'error');
      return;
    }

    try {
      const res = await fetch('/api/bet/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          number: cleanNum,
          digits: selectedDigits,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to place bet', 'error');
        return;
      }

      // Update user state
      setCurrentUser(prev => prev ? { ...prev, balance: data.newBalance } : null);
      if (currentUser) {
        sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify({ ...currentUser, balance: data.newBalance }));
      }

      // Refresh round & txs
      fetchCurrentRound();
      fetchUserTransactions(currentUser.id);

      showToast(`Bet placed on #${cleanNum} for ${cost} units! Good luck! 🌟`, 'success');
    } catch {
      showToast('Error sending bet to server', 'error');
    }
  };

  // --- Wallet Transfers ---
  const [transferRecipient, setTransferRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('');

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const recipientId = transferRecipient.trim();
    const amount = parseInt(transferAmount.trim(), 10);

    if (!recipientId) {
      showToast('Please enter the recipient User ID.', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid transfer amount.', 'error');
      return;
    }

    if (amount > currentUser.balance) {
      showToast(`Max transferable is ${currentUser.balance} units.`, 'error');
      return;
    }

    try {
      const res = await fetch('/api/wallet/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromUserId: currentUser.id,
          toUserId: recipientId,
          amount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Transfer failed', 'error');
        return;
      }

      setCurrentUser(prev => prev ? { ...prev, balance: data.newBalance } : null);
      fetchUserTransactions(currentUser.id);
      showToast(`Sent ${amount} units to @${recipientId}!`, 'success');
      setTransferRecipient('');
      setTransferAmount('');
    } catch {
      showToast('Network error during transfer', 'error');
    }
  };

  const handleCopyReferral = () => {
    if (!currentUser) return;
    navigator.clipboard.writeText(currentUser.referralCode);
    showToast('Referral code copied to clipboard! Share for +30 bonus units.', 'success');
  };

  // Admin Instant Force Draw
  const triggerInstantDraw = async () => {
    try {
      showToast('⚡ Requesting Cloud SQL fast-forward draw...', 'info');
      const res = await fetch('/api/admin/force-draw', { method: 'POST' });
      if (res.ok) {
        fetchCurrentRound();
        showToast('Round draw triggered on cloud server!', 'success');
      }
    } catch {
      showToast('Failed to trigger draw', 'error');
    }
  };

  const handleAdminAddLiquidity = async () => {
    try {
      const res = await fetch('/api/admin/add-liquidity', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setCurrentUser(prev => prev ? { ...prev, balance: data.newBalance } : null);
        fetchAdminMetrics();
        showToast('+1,000 liquidity units added to Admin in Cloud SQL!', 'success');
      }
    } catch {}
  };

  // Format countdown
  const minutes = Math.floor(timeLeftMs / 60000);
  const seconds = Math.floor((timeLeftMs % 60000) / 1000);
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  const timerPercentage = Math.max(0, Math.min(100, (timeLeftMs / ROUND_DURATION_MS) * 100));

  return (
    <div className="min-h-screen bg-[#242424] text-gray-100 flex justify-center items-start antialiased selection:bg-[#4CAF50] selection:text-black">
      {/* Mobile Frame Container */}
      <div className="w-full max-w-md min-h-screen bg-[#2f2f2f] shadow-2xl flex flex-col relative pb-20 border-x border-[#3d3d3d]/50">
        
        {/* --- TOP NAVIGATION BAR --- */}
        <header className="sticky top-0 z-30 bg-[#262626]/95 backdrop-blur-md border-b border-[#3d3d3d] px-4 py-3 flex items-center justify-between">
          <div 
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2 cursor-pointer select-none group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#4CAF50] to-[#00ffff] flex items-center justify-center shadow-md shadow-[#4CAF50]/20 group-hover:scale-105 transition-transform">
              <i className="ri-star-smile-fill text-xl text-black"></i>
            </div>
            <div>
              <h1 className="font-pacifico text-xl text-[#00ffff] tracking-wide leading-none flex items-center gap-1">
                Star Betting
                <span className="text-[10px] font-sans font-bold px-1.5 py-0.5 rounded bg-[#4CAF50]/20 text-[#4CAF50] border border-[#4CAF50]/30 uppercase tracking-widest">
                  Cloud Live
                </span>
              </h1>
              <p className="text-[10px] text-gray-400 font-mono tracking-tight mt-0.5">
                5-Min Rounds &bull; Split Pot &bull; Instant Win
              </p>
            </div>
          </div>

          {/* User Balance Badge or Auth Trigger */}
          <div className="flex items-center gap-2">
            {currentUser ? (
              <div 
                onClick={() => setActiveTab('wallet')}
                className="flex items-center bg-[#1f1f1f] hover:bg-[#1a1a1a] transition-all border border-[#4CAF50]/40 rounded-full py-1 pl-2.5 pr-3 cursor-pointer shadow-inner group"
                title="Click to view Wallet"
              >
                <div className="w-5 h-5 rounded-full bg-[#4CAF50]/20 flex items-center justify-center mr-1.5 text-[#4CAF50]">
                  <i className="ri-coin-fill text-xs"></i>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-xs font-black font-mono text-[#00ffff] tracking-tight group-hover:text-white transition-colors">
                    {currentUser.balance.toLocaleString()} <span className="text-[10px] text-[#4CAF50] font-sans">units</span>
                  </span>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setActiveTab('profile')}
                className="text-xs font-bold bg-[#4CAF50] hover:bg-[#43a047] text-black px-3 py-1.5 rounded-full transition shadow-md shadow-[#4CAF50]/30 flex items-center gap-1"
              >
                <i className="ri-login-box-line"></i>
                Sign In
              </button>
            )}

            {isAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition border cursor-pointer ${
                  activeTab === 'admin' 
                    ? 'bg-[#00ffff] text-black border-[#00ffff] shadow-lg shadow-[#00ffff]/40' 
                    : 'bg-[#383838] text-[#00ffff] border-[#00ffff]/30 hover:bg-[#444]'
                }`}
                title="Admin Control Panel"
              >
                <i className="ri-shield-flash-fill text-sm"></i>
              </button>
            )}
          </div>
        </header>

        {/* --- LIVE ROUND STATUS STRIP --- */}
        <div className="bg-[#242424] px-4 py-2 border-b border-[#383838] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-1.5 text-gray-300">
            <span className="w-2 h-2 rounded-full bg-[#4CAF50] animate-ping"></span>
            <span className="font-bold text-gray-200">Round #{activeRound.roundNumber}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-400">
              Pot: <strong className="text-[#00ffff] font-black">{activeRound.pot}</strong> units
            </span>
            <div className="flex items-center gap-1 bg-[#1a1a1a] px-2 py-0.5 rounded-md border border-[#3d3d3d] text-gray-200">
              <i className="ri-time-line text-[#4CAF50]"></i>
              <span className={`font-bold font-mono ${timeLeftMs < 30000 ? 'text-red-400 animate-pulse' : 'text-[#4CAF50]'}`}>
                {formattedTime}
              </span>
            </div>
          </div>
        </div>

        {/* --- REVEAL / DRAWING OVERLAY MODAL --- */}
        {isRevealing && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-[#262626] border-2 border-[#00ffff] rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl shadow-[#00ffff]/20 animate-in fade-in zoom-in duration-300">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-tr from-[#4CAF50] to-[#00ffff] flex items-center justify-center mb-3 animate-spin">
                <i className="ri-dice-5-fill text-3xl text-black"></i>
              </div>
              <h3 className="font-pacifico text-2xl text-[#00ffff] mb-1">
                Round #{revealData?.roundNumber} Draw!
              </h3>
              <p className="text-xs text-gray-300 mb-4 font-mono">
                Server-verified draw &bull; Next round starts in 5s
              </p>

              {/* Revealed Winning Digits */}
              <div className="bg-[#191919] p-3 rounded-xl border border-[#4CAF50]/40 mb-4">
                <span className="text-[11px] uppercase tracking-wider text-gray-400 font-bold block mb-1">
                  Winning Number
                </span>
                <div className="flex justify-center items-center gap-1.5 font-mono text-2xl font-black text-white">
                  {revealData?.winningNumber.split('').map((char, idx) => (
                    <span 
                      key={`reveal-digit-${idx}-${char}`} 
                      className="w-9 h-11 bg-gradient-to-b from-[#333] to-[#222] border border-[#00ffff]/60 rounded-lg flex items-center justify-center text-[#00ffff] shadow-lg shadow-[#00ffff]/10 animate-bounce"
                      style={{ animationDelay: `${idx * 120}ms` }}
                    >
                      {char}
                    </span>
                  ))}
                </div>
              </div>

              {/* Winners Announcement */}
              <div className="text-left bg-[#1f1f1f] p-3 rounded-xl border border-[#333] text-xs">
                <div className="flex justify-between items-center mb-2 font-bold text-gray-300">
                  <span>Pot Split ({revealData?.pot} units)</span>
                  <span className="text-[#4CAF50]">
                    {revealData?.winners.length 
                      ? `${revealData.winners.length} Winner${revealData.winners.length > 1 ? 's' : ''}`
                      : 'No Winners'}
                  </span>
                </div>
                {revealData && revealData.winners.length > 0 ? (
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {revealData.winners.map((win, idx) => (
                      <div key={`reveal-win-${win.userId}-${win.betNumber}-${idx}`} className="flex justify-between items-center bg-[#292929] px-2.5 py-1.5 rounded-lg border border-[#4CAF50]/30 text-white">
                        <span className="font-bold flex items-center gap-1">
                          <i className="ri-trophy-fill text-yellow-400"></i>
                          @{win.userId} <span className="text-gray-400 font-mono text-[10px]">({win.betNumber})</span>
                        </span>
                        <span className="text-yellow-300 font-black font-mono">+{win.payout} units</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 italic text-center py-2">
                    No matching bets this round! Pot rolled to house pool.
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-gray-400">
                <span className="w-2 h-2 rounded-full bg-[#00ffff] animate-ping"></span>
                Next round starting...
              </div>
            </div>
          </div>
        )}

        {/* --- MAIN TAB CONTENT ROUTER --- */}
        <main className="flex-1 p-4 overflow-y-auto space-y-4">
          
          {/* TAB: HOME */}
          {activeTab === 'home' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Hero Banner Card */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2a3a2a] via-[#242d2a] to-[#1e2422] border border-[#4CAF50]/40 p-4 shadow-xl">
                <div className="absolute -right-4 -bottom-4 text-7xl text-[#4CAF50]/10 font-black select-none pointer-events-none">
                  ★
                </div>

                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4CAF50]/20 text-[#4CAF50] text-[11px] font-bold border border-[#4CAF50]/30">
                      <i className="ri-fire-fill"></i> Live Online Jackpot
                    </span>
                    <h2 className="text-2xl font-black text-white mt-1 font-sans">
                      Round #{activeRound.roundNumber}
                    </h2>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-400 block font-mono">TOTAL POT</span>
                    <span className="text-2xl font-black font-mono text-[#00ffff] tracking-tight drop-shadow-sm">
                      {activeRound.pot} <span className="text-xs text-gray-300">units</span>
                    </span>
                  </div>
                </div>

                {/* Progress bar and countdown timer */}
                <div className="space-y-1 mb-4">
                  <div className="flex justify-between text-[11px] font-mono text-gray-300">
                    <span>Draw Countdown</span>
                    <span className="font-bold text-[#4CAF50]">{formattedTime} remaining</span>
                  </div>
                  <div className="w-full bg-[#1a1a1a] h-2 rounded-full overflow-hidden border border-[#383838]">
                    <div 
                      className="h-full bg-gradient-to-r from-[#4CAF50] to-[#00ffff] transition-all duration-500 rounded-full"
                      style={{ width: `${timerPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {/* Quick Action Button */}
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setActiveTab('bet')}
                    className="w-full py-2.5 px-3 bg-[#4CAF50] hover:bg-[#43a047] active:scale-98 text-black font-bold text-sm rounded-xl shadow-lg shadow-[#4CAF50]/30 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <i className="ri-add-circle-fill text-lg"></i>
                    Place Number Bet
                  </button>
                  <button 
                    onClick={() => setActiveTab('wallet')}
                    className="w-full py-2.5 px-3 bg-[#383838] hover:bg-[#444] text-white font-bold text-sm rounded-xl border border-[#4d4d4d] transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <i className="ri-wallet-3-line text-lg text-[#00ffff]"></i>
                    My Wallet
                  </button>
                </div>

                {/* Game Live Indicator */}
                <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-400 font-mono">
                  <span className="flex items-center gap-1.5 text-gray-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF50] animate-pulse"></span>
                    Fair Play &bull; Pari-Mutuel Split
                  </span>
                  {isAdmin && (
                    <button 
                      onClick={triggerInstantDraw}
                      className="text-[#00ffff] hover:underline flex items-center gap-0.5 font-bold cursor-pointer"
                    >
                      <i className="ri-flashlight-line"></i> Force Draw
                    </button>
                  )}
                </div>
              </div>

              {/* Current Active Round Bets */}
              <div className="bg-[#282828] rounded-xl border border-[#3d3d3d] p-3.5 shadow-md">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-gray-200">
                    <i className="ri-receipt-line text-[#4CAF50]"></i>
                    <span>Multiplayer Bets in Round #{activeRound.roundNumber}</span>
                  </div>
                  <span className="text-xs text-gray-400 font-mono">
                    {activeRound.bets.length} placed
                  </span>
                </div>

                {activeRound.bets.length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-xs">
                    <i className="ri-copper-coin-line text-3xl text-gray-500 mb-1 block"></i>
                    No bets placed yet for this round. Be the first to enter!
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {activeRound.bets.map((b, idx) => (
                      <div 
                        key={b.id || `bet-${b.userId}-${b.number}-${idx}`} 
                        className={`flex items-center justify-between p-2 rounded-lg border text-xs ${
                          b.userId === currentUser?.id 
                            ? 'bg-[#1e2f1e] border-[#4CAF50]/60' 
                            : 'bg-[#222222] border-[#383838]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold px-2 py-0.5 rounded bg-[#333] text-[#00ffff] border border-[#444]">
                            #{b.number}
                          </span>
                          <span className="text-gray-300 font-medium">
                            @{b.userId}
                            {b.userId === currentUser?.id && (
                              <span className="ml-1 text-[10px] text-[#4CAF50] font-bold">(You)</span>
                            )}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-200 font-bold font-mono">{b.cost} units</span>
                          <span className="text-[10px] text-gray-400 block font-mono">{b.digits} digit{b.digits > 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Results Section: Recent Winning Rounds */}
              <div className="bg-[#282828] rounded-xl border border-[#3d3d3d] p-3.5 shadow-md">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-gray-200">
                    <i className="ri-history-line text-[#00ffff]"></i>
                    <span>Recent Round Results</span>
                  </div>
                  <span className="text-[11px] text-[#4CAF50] font-bold">Cloud Verified</span>
                </div>

                {roundHistory.length === 0 ? (
                  <p className="text-gray-400 text-xs text-center py-4">No completed rounds recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {roundHistory.slice(0, 4).map((r, idx) => (
                      <div key={r.id || `round-${r.roundNumber}-${idx}`} className="bg-[#202020] rounded-xl p-2.5 border border-[#363636]">
                        <div className="flex justify-between items-start mb-1.5">
                          <span className="text-xs font-bold text-gray-300">
                            Round #{r.roundNumber}
                          </span>
                          <span className="text-xs font-mono font-bold text-gray-400">
                            Pot: <strong className="text-white">{r.pot} units</strong>
                          </span>
                        </div>

                        {/* Digits Display */}
                        <div className="flex items-center justify-between bg-[#191919] px-2 py-1.5 rounded-lg border border-[#303030]">
                          <span className="text-[10px] text-gray-400 font-mono uppercase">Winning #</span>
                          <div className="flex gap-1 font-mono font-bold text-sm text-[#00ffff]">
                            {r.winningNumber.split('').map((c, i) => (
                              <span key={`round-${r.roundNumber}-char-${i}-${c}`} className="w-5 h-6 bg-[#2a2a2a] rounded flex items-center justify-center border border-[#3d3d3d]">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Winner names */}
                        <div className="mt-2 text-[11px] flex justify-between items-center text-gray-300">
                          <span>Winners:</span>
                          {r.winners && r.winners.length > 0 ? (
                            <div className="flex flex-wrap gap-1 justify-end">
                              {r.winners.map((w, wIdx) => (
                                <span key={`round-${r.roundNumber}-win-${w.userId}-${w.betNumber}-${wIdx}`} className="bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-0.5">
                                  <i className="ri-vip-crown-fill text-[9px]"></i>
                                  @{w.userId} (+{w.payout})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-500 italic text-[10px]">House kept pot</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Referral Promo Card */}
              {currentUser && (
                <div className="bg-gradient-to-r from-[#2f1f3a] to-[#251f2b] p-3.5 rounded-xl border border-purple-500/40 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                      Invite & Earn
                    </span>
                    <h4 className="text-sm font-bold text-white">Get +30 Bonus Units</h4>
                    <p className="text-[11px] text-gray-300">When friends sign up with your code</p>
                  </div>
                  <button
                    onClick={handleCopyReferral}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-lg shadow-md transition flex items-center gap-1 cursor-pointer"
                  >
                    <i className="ri-file-copy-line"></i>
                    {currentUser.referralCode}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB: BET */}
          {activeTab === 'bet' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-[#282828] rounded-2xl border border-[#3d3d3d] p-4 shadow-lg">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-1.5">
                      <i className="ri-copper-coin-line text-[#4CAF50]"></i>
                      Select Your Numbers
                    </h2>
                    <p className="text-xs text-gray-400">Match the draw to split the round jackpot pot</p>
                  </div>
                  <button 
                    onClick={handleRandomizeNumber}
                    className="text-xs font-bold bg-[#383838] hover:bg-[#444] text-[#00ffff] border border-[#00ffff]/30 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition cursor-pointer"
                    title="Generate lucky random number"
                  >
                    <i className="ri-shuffle-line"></i>
                    Quick Pick
                  </button>
                </div>

                {/* Digit Scale Selector */}
                <div className="space-y-1.5 mb-4">
                  <label className="text-xs font-bold text-gray-300 block">
                    1. Choose Digit Tier &amp; Cost
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map((num) => {
                      const cost = DIGIT_COSTS[num];
                      const isSelected = selectedDigits === num;
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleDigitSelect(num)}
                          className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                            isSelected 
                              ? 'bg-[#1b3320] border-[#4CAF50] text-white shadow-md shadow-[#4CAF50]/20' 
                              : 'bg-[#202020] border-[#383838] text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-xs">{num} Digit{num > 1 ? 's' : ''}</span>
                            {isSelected && <i className="ri-checkbox-circle-fill text-[#4CAF50] text-xs"></i>}
                          </div>
                          <span className={`text-[11px] font-mono font-bold block mt-0.5 ${isSelected ? 'text-[#00ffff]' : 'text-gray-400'}`}>
                            {cost} units
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Number Display Screen */}
                <div className="space-y-1.5 mb-4">
                  <label className="text-xs font-bold text-gray-300 flex justify-between">
                    <span>2. Enter {selectedDigits}-Digit Number</span>
                    <span className="text-[#00ffff] font-mono text-[11px]">
                      {betNumberInput.length} / {selectedDigits} digits
                    </span>
                  </label>
                  
                  <div className="bg-[#181818] border-2 border-[#4CAF50] rounded-xl p-3 flex items-center justify-center gap-2">
                    {Array.from({ length: selectedDigits }).map((_, idx) => {
                      const char = betNumberInput[idx] || '';
                      return (
                        <div 
                          key={idx}
                          className={`w-10 h-12 rounded-lg flex items-center justify-center text-2xl font-black font-mono border transition-all ${
                            char 
                              ? 'bg-[#292929] border-[#00ffff] text-[#00ffff] shadow-md shadow-[#00ffff]/10' 
                              : 'bg-[#202020] border-[#383838] text-gray-600'
                          }`}
                        >
                          {char || '•'}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* On-screen Keypad */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'BACK'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleKeypadPress(key)}
                      className={`h-11 rounded-xl font-bold font-mono text-base transition flex items-center justify-center cursor-pointer ${
                        key === 'CLEAR' 
                          ? 'bg-[#382020] text-red-300 hover:bg-[#4a2424] text-xs' 
                          : key === 'BACK' 
                            ? 'bg-[#382b20] text-yellow-300 hover:bg-[#4d3927] text-sm'
                            : 'bg-[#222] text-white hover:bg-[#333] border border-[#383838] active:scale-95'
                      }`}
                    >
                      {key === 'BACK' ? <i className="ri-delete-back-2-line text-lg"></i> : key}
                    </button>
                  ))}
                </div>

                {/* Bet Summary & Confirmation */}
                <div className="bg-[#202020] p-3 rounded-xl border border-[#383838] mb-4 space-y-1 text-xs">
                  <div className="flex justify-between text-gray-300">
                    <span>Bet Cost:</span>
                    <strong className="text-white font-mono">{DIGIT_COSTS[selectedDigits]} units</strong>
                  </div>
                  <div className="flex justify-between text-gray-300">
                    <span>Target Number:</span>
                    <strong className="text-[#00ffff] font-mono">#{betNumberInput || '---'}</strong>
                  </div>
                  <div className="flex justify-between text-gray-300">
                    <span>Your Balance:</span>
                    <strong className="text-[#4CAF50] font-mono">{currentUser?.balance ?? 0} units</strong>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePlaceBet}
                  disabled={!currentUser || betNumberInput.length !== selectedDigits}
                  className="w-full py-3 bg-[#4CAF50] hover:bg-[#43a047] disabled:opacity-40 disabled:cursor-not-allowed text-black font-extrabold text-base rounded-xl shadow-lg shadow-[#4CAF50]/30 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="ri-check-line text-xl"></i>
                  Confirm Bet ({DIGIT_COSTS[selectedDigits]} units)
                </button>
              </div>

              {/* Rules Explanation Box */}
              <div className="bg-[#242424] rounded-xl p-3 border border-[#383838] text-xs text-gray-400 space-y-1.5">
                <div className="font-bold text-gray-200 flex items-center gap-1">
                  <i className="ri-information-line text-[#00ffff]"></i>
                  How Winning Works:
                </div>
                <p>
                  At the end of every 5-minute round, a random 6-digit number is drawn.
                </p>
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  <li>A <strong>1-digit</strong> bet matches the last digit (e.g. <code>* * * * * 9</code>).</li>
                  <li>A <strong>2-digit</strong> bet matches the last 2 digits (e.g. <code>* * * * 4 2</code>).</li>
                  <li>A <strong>6-digit</strong> bet matches all 6 digits exactly.</li>
                  <li>All matching players split that round's pot equally!</li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB: WALLET */}
          {activeTab === 'wallet' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {currentUser ? (
                <>
                  {/* Balance Showcase Card */}
                  <div className="bg-gradient-to-br from-[#223322] via-[#202920] to-[#1c1c1c] p-4 rounded-2xl border border-[#4CAF50]/50 shadow-xl relative overflow-hidden">
                    <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">
                      Total Wallet Balance
                    </span>
                    <div className="flex items-baseline gap-2 mt-1 mb-3">
                      <span className="text-3xl font-black font-mono text-[#00ffff] tracking-tight">
                        {currentUser.balance.toLocaleString()}
                      </span>
                      <span className="text-sm font-bold text-[#4CAF50]">units</span>
                    </div>

                    <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-gray-300">
                      <span>User ID: <strong className="text-white">@{currentUser.username}</strong></span>
                      <span className="text-gray-400">Instant cloud transfers</span>
                    </div>
                  </div>

                  {/* Referral Code Box */}
                  <div className="bg-[#282828] p-3.5 rounded-xl border border-[#3d3d3d] shadow-md">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-bold text-gray-200 flex items-center gap-1">
                        <i className="ri-gift-line text-purple-400"></i>
                        Your Referral Code
                      </span>
                      <span className="text-[11px] text-purple-300 font-mono">
                        {currentUser.totalReferrals || 0} friends joined
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mb-2.5">
                      Share your code with friends. They get a 30-unit welcome bonus and you get +30 units!
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-[#1a1a1a] border border-[#3d3d3d] rounded-xl px-3 py-2 font-mono font-bold text-[#00ffff] text-sm tracking-widest text-center select-all">
                        {currentUser.referralCode}
                      </div>
                      <button
                        onClick={handleCopyReferral}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-3.5 py-2.5 rounded-xl transition flex items-center gap-1 shadow-md shadow-purple-600/30 cursor-pointer"
                      >
                        <i className="ri-file-copy-2-line"></i>
                        Copy
                      </button>
                    </div>
                  </div>

                  {/* User-to-User Transfer Section */}
                  <div className="bg-[#282828] p-3.5 rounded-xl border border-[#3d3d3d] shadow-md">
                    <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-1.5">
                      <i className="ri-send-plane-fill text-[#4CAF50]"></i>
                      Transfer Units to Another User
                    </h3>
                    <p className="text-[11px] text-gray-400 mb-3">
                      Send units instantly to any registered Star Betting player on Cloud SQL.
                    </p>

                    <form onSubmit={handleTransfer} className="space-y-2.5">
                      <div>
                        <label className="text-[11px] font-bold text-gray-300 block mb-1">
                          Recipient User ID
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-gray-400 text-xs">@</span>
                          <input
                            type="text"
                            placeholder="e.g. lucky_lisa, crypto_dan"
                            value={transferRecipient}
                            onChange={(e) => setTransferRecipient(e.target.value)}
                            className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-[#4CAF50] rounded-xl pl-7 pr-3 py-2 text-xs text-white focus:outline-none font-mono"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-gray-300 block mb-1">
                          Amount (Units)
                        </label>
                        <input
                          type="number"
                          placeholder="e.g. 50"
                          min="1"
                          max={currentUser.balance}
                          value={transferAmount}
                          onChange={(e) => setTransferAmount(e.target.value)}
                          className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-[#4CAF50] rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-[#4CAF50] hover:bg-[#43a047] text-black font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <i className="ri-arrow-right-up-line"></i>
                        Send Transfer Now
                      </button>
                    </form>
                  </div>

                  {/* Transaction History (Color Coded) */}
                  <div className="bg-[#282828] p-3.5 rounded-xl border border-[#3d3d3d] shadow-md">
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <i className="ri-file-list-3-line text-[#00ffff]"></i>
                        Transaction History
                      </h3>
                      <span className="text-[10px] text-gray-400 font-mono">
                        {transactions.length} records
                      </span>
                    </div>

                    {/* Color Legend */}
                    <div className="flex flex-wrap gap-2 text-[10px] mb-3 pb-2 border-b border-[#383838]">
                      <span className="flex items-center gap-1 text-[#4CAF50]">
                        <span className="w-2 h-2 rounded-full bg-[#4CAF50]"></span> Green: In
                      </span>
                      <span className="flex items-center gap-1 text-red-400">
                        <span className="w-2 h-2 rounded-full bg-red-400"></span> Red: Out
                      </span>
                      <span className="flex items-center gap-1 text-yellow-300">
                        <span className="w-2 h-2 rounded-full bg-yellow-400"></span> Yellow: Win
                      </span>
                      <span className="flex items-center gap-1 text-purple-400">
                        <span className="w-2 h-2 rounded-full bg-purple-400"></span> Purple: Bonus
                      </span>
                    </div>

                    {transactions.length === 0 ? (
                      <p className="text-center py-5 text-gray-500 text-xs italic">
                        No transactions recorded yet.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {transactions.map((tx, idx) => {
                          let colorClass = 'text-[#4CAF50] border-[#4CAF50]/40 bg-[#1e2f1e]/40';
                          let badgeBg = 'bg-[#4CAF50]/20 text-[#4CAF50]';
                          let sign = '+';

                          if (tx.type === 'out') {
                            colorClass = 'text-red-400 border-red-500/40 bg-[#2f1e1e]/40';
                            badgeBg = 'bg-red-500/20 text-red-400';
                            sign = '-';
                          } else if (tx.type === 'win') {
                            colorClass = 'text-yellow-300 border-yellow-500/40 bg-[#312b1a]/40';
                            badgeBg = 'bg-yellow-500/20 text-yellow-300';
                            sign = '+';
                          } else if (tx.type === 'bonus') {
                            colorClass = 'text-purple-400 border-purple-500/40 bg-[#2c1f38]/40';
                            badgeBg = 'bg-purple-500/20 text-purple-400';
                            sign = '+';
                          }

                          return (
                            <div
                              key={tx.id || `tx-${tx.userId}-${tx.timestamp}-${idx}`}
                              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${colorClass}`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold font-mono ${badgeBg}`}>
                                    {tx.type}
                                  </span>
                                  <span className="font-bold text-gray-200">{tx.title}</span>
                                </div>
                                <p className="text-[10px] text-gray-400">{tx.description}</p>
                                <span className="text-[9px] text-gray-500 block">
                                  {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-right font-mono font-black text-sm">
                                {sign}{tx.amount} <span className="text-[10px] font-sans">units</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-10 bg-[#282828] rounded-2xl border border-[#3d3d3d] p-6">
                  <i className="ri-wallet-3-line text-4xl text-[#00ffff] mb-2 block"></i>
                  <h3 className="text-base font-bold text-white mb-1">Sign In to Access Wallet</h3>
                  <p className="text-xs text-gray-400 mb-4">
                    View balance, transfer units, check transaction history, and get your referral bonus.
                  </p>
                  <button
                    onClick={() => setActiveTab('profile')}
                    className="py-2.5 px-6 bg-[#4CAF50] hover:bg-[#43a047] text-black font-bold text-xs rounded-xl shadow-md cursor-pointer"
                  >
                    Go to Sign In
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB: PROFILE & AUTH */}
          {activeTab === 'profile' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {currentUser ? (
                <div className="space-y-4">
                  {/* Profile Header */}
                  <div className="bg-[#282828] rounded-2xl border border-[#3d3d3d] p-4 text-center shadow-lg relative">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-[#4CAF50] to-[#00ffff] text-black flex items-center justify-center mx-auto mb-2 text-2xl font-bold shadow-md shadow-[#4CAF50]/30 font-pacifico">
                      {currentUser.username.charAt(0).toUpperCase()}
                    </div>
                    <h2 className="text-lg font-bold text-white">@{currentUser.username}</h2>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">
                      Referral Code: <span className="text-[#00ffff] font-bold">{currentUser.referralCode}</span>
                    </p>

                    {isAdmin && (
                      <div className="mt-2 inline-flex items-center gap-1 bg-[#00ffff]/20 text-[#00ffff] border border-[#00ffff]/40 px-2.5 py-0.5 rounded-full text-xs font-bold">
                        <i className="ri-shield-check-fill"></i> Master Administrator
                      </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-[#383838] grid grid-cols-2 gap-2 text-left">
                      <div className="bg-[#202020] p-2.5 rounded-xl border border-[#333]">
                        <span className="text-[10px] text-gray-400 block">Available Balance</span>
                        <span className="text-sm font-bold font-mono text-[#4CAF50]">
                          {currentUser.balance} units
                        </span>
                      </div>
                      <div className="bg-[#202020] p-2.5 rounded-xl border border-[#333]">
                        <span className="text-[10px] text-gray-400 block">Referrals Joined</span>
                        <span className="text-sm font-bold font-mono text-purple-300">
                          {currentUser.totalReferrals || 0} users
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-2">
                    {isAdmin && (
                      <button
                        onClick={() => setActiveTab('admin')}
                        className="w-full py-2.5 bg-[#00ffff] hover:bg-[#00e5e5] text-black font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <i className="ri-dashboard-fill text-sm"></i>
                        Open Admin Dashboard Panel
                      </button>
                    )}

                    <button
                      onClick={handleLogout}
                      className="w-full py-2.5 bg-[#3a2020] hover:bg-[#4a2626] text-red-300 border border-red-500/30 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <i className="ri-logout-box-r-line"></i>
                      Sign Out
                    </button>
                  </div>
                </div>
              ) : (
                /* Login / Signup Form */
                <div className="bg-[#282828] rounded-2xl border border-[#3d3d3d] p-4 shadow-xl">
                  {/* Google Sign In option */}
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 mb-3 bg-white hover:bg-gray-100 text-gray-800 font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <i className="ri-google-fill text-base text-red-500"></i>
                    Sign In with Google
                  </button>

                  <div className="flex items-center my-3">
                    <div className="flex-1 border-t border-[#383838]"></div>
                    <span className="px-2 text-[10px] text-gray-400 uppercase">Or with Star ID</span>
                    <div className="flex-1 border-t border-[#383838]"></div>
                  </div>

                  {/* Toggle header */}
                  <div className="flex bg-[#202020] p-1 rounded-xl mb-4 border border-[#383838]">
                    <button
                      type="button"
                      onClick={() => setAuthTab('login')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        authTab === 'login' ? 'bg-[#4CAF50] text-black shadow' : 'text-gray-400'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthTab('signup')}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        authTab === 'signup' ? 'bg-[#4CAF50] text-black shadow' : 'text-gray-400'
                      }`}
                    >
                      Create Account
                    </button>
                  </div>

                  {authTab === 'login' ? (
                    <form onSubmit={handleLogin} className="space-y-3">
                      <div>
                        <label className="text-xs font-bold text-gray-300 block mb-1">User ID</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. admin or lucky_lisa"
                          value={authId}
                          onChange={(e) => setAuthId(e.target.value)}
                          className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-[#4CAF50] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-300 block mb-1">Password</label>
                        <input
                          type="password"
                          required
                          placeholder="Enter password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-[#4CAF50] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-[#4CAF50] hover:bg-[#43a047] text-black font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
                      >
                        Sign In
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleSignup} className="space-y-3">
                      <div className="bg-[#1e2f1e] p-2.5 rounded-xl border border-[#4CAF50]/40 text-xs text-[#4CAF50] flex items-center gap-2">
                        <i className="ri-gift-fill text-lg"></i>
                        <span>Includes <strong>30 units welcome bonus</strong> automatically!</span>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-300 block mb-1">Pick a User ID</label>
                        <input
                          type="text"
                          required
                          placeholder="Choose unique username"
                          value={authId}
                          onChange={(e) => setAuthId(e.target.value)}
                          className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-[#4CAF50] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-300 block mb-1">Password</label>
                        <input
                          type="password"
                          required
                          placeholder="Create strong password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-[#4CAF50] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-gray-300 block mb-1">
                          Referral Code <span className="text-gray-400 font-normal">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. STAR-BOSS or STAR-DAN7"
                          value={authReferralCode}
                          onChange={(e) => setAuthReferralCode(e.target.value)}
                          className="w-full bg-[#1c1c1c] border border-[#3d3d3d] focus:border-purple-400 rounded-xl px-3 py-2 text-xs text-white uppercase focus:outline-none font-mono"
                        />
                        <span className="text-[10px] text-gray-400 block mt-0.5">
                          Referrer will get +30 units reward.
                        </span>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2.5 bg-[#4CAF50] hover:bg-[#43a047] text-black font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
                      >
                        Create Account &amp; Claim 30 Units
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: ADMIN PANEL (Only visible if currentUser is admin) */}
          {activeTab === 'admin' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {isAdmin ? (
                <>
                  <div className="bg-[#222] p-3.5 rounded-2xl border border-[#00ffff]/40 shadow-lg">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-[#00ffff] tracking-wider block">
                          Restricted Control
                        </span>
                        <h2 className="text-lg font-bold text-white flex items-center gap-1.5">
                          <i className="ri-shield-keyhole-fill text-[#00ffff]"></i>
                          Admin Dashboard
                        </h2>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-mono font-bold border border-red-500/30">
                        Admin Authorized
                      </span>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-[#191919] p-3 rounded-xl border border-[#333]">
                        <span className="text-[10px] text-gray-400 block uppercase font-mono">System Balance</span>
                        <span className="text-lg font-black font-mono text-[#00ffff]">
                          {totalSystemBalance.toLocaleString()} <span className="text-xs text-gray-400 font-sans">units</span>
                        </span>
                        <span className="text-[10px] text-gray-500 block">Across all user wallets</span>
                      </div>

                      <div className="bg-[#191919] p-3 rounded-xl border border-[#333]">
                        <span className="text-[10px] text-gray-400 block uppercase font-mono">House Profit</span>
                        <span className="text-lg font-black font-mono text-[#4CAF50]">
                          +{houseStats.houseProfit.toLocaleString()} <span className="text-xs text-gray-400 font-sans">units</span>
                        </span>
                        <span className="text-[10px] text-gray-500 block">Retained unhit pots</span>
                      </div>

                      <div className="bg-[#191919] p-3 rounded-xl border border-[#333]">
                        <span className="text-[10px] text-gray-400 block uppercase font-mono">Total Users</span>
                        <span className="text-lg font-black font-mono text-purple-400">
                          {totalRegisteredUsers}
                        </span>
                        <span className="text-[10px] text-gray-500 block">Registered players</span>
                      </div>

                      <div className="bg-[#191919] p-3 rounded-xl border border-[#333]">
                        <span className="text-[10px] text-gray-400 block uppercase font-mono">Total Bets</span>
                        <span className="text-lg font-black font-mono text-yellow-300">
                          {houseStats.totalBetsCount}
                        </span>
                        <span className="text-[10px] text-gray-500 block">Vol: {houseStats.totalBetsVolume} units</span>
                      </div>
                    </div>
                  </div>

                  {/* Immediate Control Tools */}
                  <div className="bg-[#282828] p-3.5 rounded-xl border border-[#3d3d3d] space-y-2">
                    <h3 className="text-xs font-bold text-gray-200">Round Management Actions</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={triggerInstantDraw}
                        className="py-2 px-3 bg-[#00ffff] hover:bg-[#00e5e5] text-black font-bold text-xs rounded-xl transition flex items-center justify-center gap-1 shadow-md shadow-[#00ffff]/20 cursor-pointer"
                      >
                        <i className="ri-flashlight-line"></i>
                        Force Draw Now
                      </button>

                      <button
                        onClick={handleAdminAddLiquidity}
                        className="py-2 px-3 bg-[#333] hover:bg-[#444] text-white font-bold text-xs rounded-xl border border-[#444] transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <i className="ri-add-box-line text-[#4CAF50]"></i>
                        +1,000 Admin Units
                      </button>
                    </div>
                  </div>

                  {/* Registered Users Table */}
                  <div className="bg-[#282828] p-3.5 rounded-xl border border-[#3d3d3d]">
                    <h3 className="text-xs font-bold text-gray-200 mb-2 flex items-center justify-between">
                      <span>Registered User Accounts</span>
                      <span className="text-[10px] font-mono text-gray-400">Total: {totalRegisteredUsers}</span>
                    </h3>
                    
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {adminUsersList.map((u, idx) => (
                        <div key={`admin-user-${u.id}-${idx}`} className="p-2 rounded-lg bg-[#202020] border border-[#333] flex justify-between items-center text-xs">
                          <div>
                            <div className="flex items-center gap-1 font-bold text-gray-200">
                              <span>@{u.username || u.id}</span>
                              {u.id === 'admin' && (
                                <span className="text-[9px] bg-[#00ffff]/20 text-[#00ffff] px-1 rounded">Admin</span>
                              )}
                            </div>
                            <span className="text-[10px] text-gray-400 font-mono">
                              Ref: {u.referralCode} &bull; Invited: {u.totalReferrals || 0}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-bold text-[#4CAF50]">{u.balance.toLocaleString()} units</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-[#282828] p-6 rounded-2xl border border-red-500/30 text-center">
                  <i className="ri-lock-2-line text-4xl text-red-400 mb-2 block"></i>
                  <h3 className="text-base font-bold text-white mb-1">Access Restricted</h3>
                  <p className="text-xs text-gray-400 mb-4">
                    The admin control panel is reserved for authorized system administrators.
                  </p>
                </div>
              )}
            </div>
          )}
        </main>

        {/* --- BOTTOM MOBILE TAB BAR --- */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none">
          <div className="w-full max-w-md bg-[#222222]/95 backdrop-blur-md border-t border-[#3d3d3d] px-2 py-1.5 flex justify-around items-center pointer-events-auto shadow-2xl">
            <button
              onClick={() => setActiveTab('home')}
              className={`flex-1 py-1.5 flex flex-col items-center justify-center transition-all cursor-pointer ${
                activeTab === 'home' ? 'text-[#4CAF50] scale-105' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <i className={`text-xl ${activeTab === 'home' ? 'ri-home-5-fill' : 'ri-home-5-line'}`}></i>
              <span className="text-[10px] font-bold mt-0.5">Home</span>
            </button>

            <button
              onClick={() => setActiveTab('bet')}
              className={`flex-1 py-1.5 flex flex-col items-center justify-center transition-all cursor-pointer ${
                activeTab === 'bet' ? 'text-[#4CAF50] scale-105' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <div className="relative">
                <i className={`text-xl ${activeTab === 'bet' ? 'ri-copper-coin-fill' : 'ri-copper-coin-line'}`}></i>
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00ffff]"></span>
              </div>
              <span className="text-[10px] font-bold mt-0.5">Bet</span>
            </button>

            <button
              onClick={() => setActiveTab('wallet')}
              className={`flex-1 py-1.5 flex flex-col items-center justify-center transition-all cursor-pointer ${
                activeTab === 'wallet' ? 'text-[#4CAF50] scale-105' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <i className={`text-xl ${activeTab === 'wallet' ? 'ri-wallet-3-fill' : 'ri-wallet-3-line'}`}></i>
              <span className="text-[10px] font-bold mt-0.5">Wallet</span>
            </button>

            <button
              onClick={() => setActiveTab('profile')}
              className={`flex-1 py-1.5 flex flex-col items-center justify-center transition-all cursor-pointer ${
                activeTab === 'profile' ? 'text-[#4CAF50] scale-105' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <i className={`text-xl ${activeTab === 'profile' ? 'ri-user-3-fill' : 'ri-user-3-line'}`}></i>
              <span className="text-[10px] font-bold mt-0.5">
                {currentUser ? currentUser.username : 'Profile'}
              </span>
            </button>

            {isAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex-1 py-1.5 flex flex-col items-center justify-center transition-all cursor-pointer ${
                  activeTab === 'admin' ? 'text-[#00ffff] scale-105' : 'text-gray-400 hover:text-[#00ffff]'
                }`}
              >
                <i className={`text-xl ${activeTab === 'admin' ? 'ri-shield-flash-fill' : 'ri-shield-flash-line'}`}></i>
                <span className="text-[10px] font-bold mt-0.5">Admin</span>
              </button>
            )}
          </div>
        </nav>

        {/* --- TOAST NOTIFICATIONS CONTAINER --- */}
        <div className="fixed top-14 left-0 right-0 z-50 flex flex-col items-center pointer-events-none px-4 space-y-2">
          {toasts.map((toast) => {
            let toastStyle = 'bg-[#292929] border-[#4CAF50] text-white';
            let icon = 'ri-information-fill text-[#4CAF50]';

            if (toast.type === 'success') {
              toastStyle = 'bg-[#1b2b1d] border-[#4CAF50] text-[#e0ffe0]';
              icon = 'ri-checkbox-circle-fill text-[#4CAF50]';
            } else if (toast.type === 'error') {
              toastStyle = 'bg-[#331c1c] border-red-500 text-red-200';
              icon = 'ri-error-warning-fill text-red-400';
            } else if (toast.type === 'win') {
              toastStyle = 'bg-[#2a2414] border-yellow-400 text-yellow-100 shadow-xl shadow-yellow-500/20';
              icon = 'ri-trophy-fill text-yellow-400';
            }

            return (
              <div
                key={toast.id}
                className={`max-w-sm w-full py-2.5 px-3.5 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs pointer-events-auto animate-in slide-in-from-top duration-200 ${toastStyle}`}
              >
                <i className={`${icon} text-lg shrink-0`}></i>
                <span className="flex-1 font-medium">{toast.message}</span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
