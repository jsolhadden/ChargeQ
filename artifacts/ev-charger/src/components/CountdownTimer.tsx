import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';

interface CountdownTimerProps {
  deadlineAt: string;
  onExpired?: () => void;
}

export function CountdownTimer({ deadlineAt, onExpired }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const deadline = new Date(deadlineAt).getTime();
      const diff = deadline - now;
      return Math.max(0, Math.floor(diff / 1000));
    };

    setTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const newTimeLeft = calculateTimeLeft();
      setTimeLeft(newTimeLeft);
      
      if (newTimeLeft === 0 && onExpired) {
        onExpired();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadlineAt, onExpired]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const isUrgent = minutes < 5;
  const isCritical = minutes < 1;

  return (
    <motion.div
      animate={isCritical ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 1, repeat: isCritical ? Infinity : 0 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-lg font-bold ${
        isCritical
          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
          : isUrgent
          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
      }`}
      data-testid="countdown-timer"
    >
      <Clock className="w-5 h-5" />
      <span data-testid="countdown-value">
        {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </motion.div>
  );
}
