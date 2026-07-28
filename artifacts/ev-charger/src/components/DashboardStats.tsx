import { motion } from 'framer-motion';
import { Zap, Users, Clock, CheckCircle } from 'lucide-react';
import type { DashboardSummary } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';

interface DashboardStatsProps {
  summary: DashboardSummary;
}

export function DashboardStats({ summary }: DashboardStatsProps) {
  const stats = [
    {
      label: 'Available',
      value: summary.availableChargers,
      total: summary.totalChargers,
      icon: Zap,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      testId: 'stat-available'
    },
    {
      label: 'Queue Length',
      value: summary.queueLength,
      icon: Users,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      testId: 'stat-queue'
    },
    {
      label: 'Avg Wait',
      value: `${summary.averageWaitMinutes}m`,
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      testId: 'stat-wait'
    },
    {
      label: 'Today',
      value: summary.todayCompletedSessions,
      icon: CheckCircle,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      testId: 'stat-completed'
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.05 }}
        >
          <Card className="p-4 border-card-border bg-card/50 backdrop-blur-sm" data-testid={stat.testId}>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-display font-bold text-foreground" data-testid={`${stat.testId}-value`}>
                  {stat.value}{stat.total !== undefined && <span className="text-muted-foreground">/{stat.total}</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stat.label}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
