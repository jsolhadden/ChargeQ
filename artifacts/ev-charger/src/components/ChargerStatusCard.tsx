import { motion } from 'framer-motion';
import { Zap, User, Clock } from 'lucide-react';
import type { Charger } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ChargerStatusCardProps {
  charger: Charger;
}

export function ChargerStatusCard({ charger }: ChargerStatusCardProps) {
  const statusConfig = {
    available: {
      label: 'Available',
      color: 'bg-green-500/20 text-green-400 border-green-500/30',
      icon: 'text-green-400',
      glow: true,
    },
    occupied: {
      label: 'In Use',
      color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      icon: 'text-amber-400',
      glow: false,
    },
    assigned: {
      label: 'Reserved',
      color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      icon: 'text-cyan-400',
      glow: false,
    },
  };

  const config = statusConfig[charger.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      data-testid={`charger-card-${charger.id}`}
    >
      <Card className="relative overflow-hidden border-card-border bg-card/50 backdrop-blur-sm">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl bg-card border border-border ${config.glow ? 'animate-pulse-glow' : ''}`}>
                <Zap className={`w-6 h-6 ${config.icon}`} />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-foreground" data-testid={`charger-name-${charger.id}`}>
                  {charger.name}
                </h3>
                <Badge 
                  variant="outline" 
                  className={`mt-1.5 font-medium ${config.color}`}
                  data-testid={`charger-status-${charger.id}`}
                >
                  {config.label}
                </Badge>
              </div>
            </div>
          </div>

          {charger.currentUserName && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 pt-4 border-t border-border"
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-4 h-4" />
                <span data-testid={`charger-user-${charger.id}`}>{charger.currentUserName}</span>
              </div>
            </motion.div>
          )}
        </div>

        {charger.status === 'available' && (
          <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-full blur-2xl" />
        )}
      </Card>
    </motion.div>
  );
}
