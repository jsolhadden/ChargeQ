import { motion } from 'framer-motion';
import { Zap, Clock, Users, CheckCircle, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function Home() {
  const features = [
    {
      icon: Zap,
      title: 'Real-time Status',
      description: 'See charger availability and queue position live',
    },
    {
      icon: Clock,
      title: 'Smart Queue',
      description: 'Fair first-come-first-served with estimated wait times',
    },
    {
      icon: Users,
      title: 'Team Coordination',
      description: "Know when it&apos;s your turn without camping the parking lot",
    },
    {
      icon: CheckCircle,
      title: 'Simple Check-in',
      description: 'Claim, check in, and check out with one tap',
    },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto px-4 py-20 md:py-32 max-w-6xl relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mb-8 animate-pulse-glow">
              <Zap className="w-10 h-10 text-primary" />
            </div>
            
            <h1 className="font-display text-5xl md:text-7xl font-bold text-foreground mb-6 leading-tight">
              Never wait for a<br />charging spot again
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground mb-12 leading-relaxed">
              ChargeQ manages our office&apos;s 2 shared EV chargers with a live waitlist queue. 
              Join remotely, get notified when it&apos;s your turn, and check in when ready.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/sign-in">
                <Button size="lg" className="text-lg h-14 px-8 font-semibold" data-testid="button-signin">
                  Sign In
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button size="lg" variant="outline" className="text-lg h-14 px-8 font-semibold" data-testid="button-signup">
                  Sign Up
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-card/30">
        <div className="container mx-auto px-4 max-w-6xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <h2 className="font-display text-4xl font-bold text-foreground mb-4">
              How it works
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              A simple, fair system for managing shared charging infrastructure
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
              >
                <Card className="p-6 border-card-border bg-card/50 backdrop-blur-sm h-full hover:border-primary/30 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10">
                      <feature.icon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                        {feature.title}
                      </h3>
                      <p className="text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-display text-4xl font-bold text-foreground mb-12 text-center">
              Three steps to charge
            </h2>

            <div className="space-y-8">
              {[
                {
                  step: '01',
                  title: 'Join the queue',
                  description: 'Check the live dashboard and join the waitlist with one tap. See your position and estimated wait time.',
                },
                {
                  step: '02',
                  title: 'Get notified',
                  description: "When a spot opens up, you'll be assigned a charger. You have 60 minutes to claim it.",
                },
                {
                  step: '03',
                  title: 'Charge and go',
                  description: "Head to your assigned spot, check in when parked, and check out when done. That's it.",
                },
              ].map((item, index) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="flex gap-6 items-start"
                >
                  <div className="flex-shrink-0 w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span className="font-display text-2xl font-bold text-primary">{item.step}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display text-2xl font-bold text-foreground mb-2">
                      {item.title}
                    </h3>
                    <p className="text-lg text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-6">
              Ready to charge?
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              Sign in to see the live queue and claim your spot.
            </p>
            <Link href="/sign-in">
              <Button size="lg" className="text-lg h-14 px-8 font-semibold" data-testid="button-cta-signin">
                Get Started
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="w-5 h-5 text-primary" />
            <span className="font-display font-bold text-foreground">ChargeQ</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Office EV charger waitlist management
          </p>
        </div>
      </footer>
    </div>
  );
}
