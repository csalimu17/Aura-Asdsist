import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Lock, ArrowRight, Sparkles, UserPlus, LogIn, X, RefreshCcw } from 'lucide-react';
import { User } from '../services/geminiService';
import { cn } from '../lib/utils';

interface AuthProps {
  onAuthSuccess: (user: User) => void;
  onClose?: () => void;
}

export default function Auth({ onAuthSuccess, onClose }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      onAuthSuccess(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-[2.5rem] shadow-2xl overflow-hidden border border-border-subtle"
      >
        <div className="p-8 sm:p-12">
          <div className="flex justify-between items-start mb-8">
            <div className="w-12 h-12 bg-text-primary rounded-2xl flex items-center justify-center shadow-xl shadow-text-primary/20 rotate-3">
              <Sparkles className="w-6 h-6 text-bg-primary" />
            </div>
            {onClose && (
              <button 
                onClick={onClose}
                className="p-2 hover:bg-text-primary/5 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <h2 className="text-3xl font-serif italic font-bold tracking-tight text-text-primary mb-2">
            {isLogin ? 'Welcome back' : 'Join Aura'}
          </h2>
          <p className="text-text-secondary mb-8 font-medium">
            {isLogin ? 'Sign in to sync your conversations' : 'Create an account to get started'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary ml-4">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary/40" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-12 pr-4 py-4 bg-text-primary/5 border border-transparent focus:border-text-primary/20 rounded-2xl transition-all outline-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary ml-4">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary/40" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-4 bg-text-primary/5 border border-transparent focus:border-text-primary/20 rounded-2xl transition-all outline-none"
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-red-500 text-xs font-bold bg-red-500/10 p-3 rounded-xl border border-red-500/20"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-text-primary text-bg-primary rounded-2xl font-bold flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-text-primary/20 disabled:opacity-50"
            >
              {isLoading ? (
                <RefreshCcw className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-border-subtle text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm font-bold text-text-secondary hover:text-text-primary transition-colors flex items-center gap-2 mx-auto"
            >
              {isLogin ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  Don't have an account? Sign up
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Already have an account? Sign in
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
