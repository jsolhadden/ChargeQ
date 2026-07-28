import { motion, AnimatePresence } from 'framer-motion';
import { Clock, TrendingUp } from 'lucide-react';
import type { QueueEntry } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

interface QueueListProps {
  queue: QueueEntry[];
  currentUserId?: string;
}

export function QueueList({ queue, currentUserId }: QueueListProps) {
  if (queue.length === 0) {
    return (
      <Card className="p-8 border-card-border bg-card/50 backdrop-blur-sm" data-testid="queue-empty">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
            <Clock className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-lg font-semibold text-foreground mb-2">
            No one in queue
          </h3>
          <p className="text-sm text-muted-foreground">
            Both chargers are available. Join the queue to reserve a spot when they're full.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-card-border bg-card/50 backdrop-blur-sm overflow-hidden" data-testid="queue-list">
      <div className="p-6 border-b border-border">
        <h2 className="font-display text-2xl font-bold text-foreground">
          Waitlist Queue
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {queue.length} {queue.length === 1 ? 'person' : 'people'} waiting
        </p>
      </div>

      <div className="divide-y divide-border">
        <AnimatePresence mode="popLayout">
          {queue.map((entry, index) => {
            const isCurrentUser = entry.userId === currentUserId;
            const waitTime = formatDistanceToNow(new Date(entry.joinedAt), { addSuffix: true });

            return (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className={`p-4 flex items-center gap-4 ${isCurrentUser ? 'bg-primary/5' : 'hover:bg-muted/30'} transition-colors`}
                data-testid={`queue-entry-${entry.id}`}
              >
                <div className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center font-display text-xl font-bold ${
                  isCurrentUser 
                    ? 'bg-primary text-primary-foreground' 
                    : 'bg-muted text-muted-foreground'
                }`} data-testid={`queue-position-${entry.id}`}>
                  {entry.position}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`font-semibold truncate ${isCurrentUser ? 'text-foreground' : 'text-foreground/90'}`} data-testid={`queue-user-${entry.id}`}>
                      {entry.userName}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-primary font-normal">(You)</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-muted-foreground" data-testid={`queue-wait-${entry.id}`}>
                      Joined {waitTime}
                    </p>
                    {entry.estimatedWaitMinutes && (
                      <>
                        <span className="text-xs text-muted-foreground">•</span>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <TrendingUp className="w-3 h-3" />
                          <span data-testid={`queue-estimate-${entry.id}`}>~{entry.estimatedWaitMinutes}m wait</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {entry.status === 'assigned' && (
                  <Badge variant="outline" className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30" data-testid={`queue-status-${entry.id}`}>
                    Assigned
                  </Badge>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Card>
  );
}
