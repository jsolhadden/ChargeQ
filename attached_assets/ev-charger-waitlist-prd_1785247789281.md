# PRD: Office EV Charger Waitlist

## 1. Overview
A web app that lets employees join a queue for office EV chargers instead of physically circling the lot. When a charger frees up, the system auto-assigns it to the next person in line and notifies them, with a timer to claim it before it passes to the next person.

## 2. Problem
The office has 2 EV charger spaces in one lot, relative to greater employee demand. Employees currently have no way to know when a charger will be free, leading to wasted time checking the lot and disputes over who's next.

## 3. Goals
- Give employees visibility into queue position and estimated wait.
- Automate "next in line" assignment so no one has to police the lot.
- Reduce idle/occupied charger time caused by people forgetting to move their car.

## 4. Non-goals (out of scope for v1)
- Payment or cost-splitting for charging.
- Sensor/IoT-based occupancy detection (relying on manual check-in/out for v1).
- Reservation/scheduling in advance (this is a live queue, not a calendar).
- Priority tiers or special access levels.

## 5. Users
- **Employees**: join the queue, check in to a charger, check out when done.
- (No separate admin/facilities role in v1, per scope above — may revisit later.)

## 6. Core Flow
1. Employee opens the app and joins the waitlist (selects charger location if multiple).
2. App shows live queue position.
3. When a charger frees up, it's auto-assigned to the next person in line (strict FIFO — no priority rules).
4. That person gets a push/SMS/email notification and has 60 minutes to confirm.
5. If they don't claim in time, it passes to the next person in line.
6. Employee checks in via the app once parked and plugged in.
7. Employee manually checks out via the app when done, which frees the charger and triggers the next assignment.

## 7. Functional Requirements
- **Login/accounts**: employees must log in (email/password or SSO — TBD) to join the queue or take any action; all actions are tied to their account.
- **Join queue**: one-tap join, shows position and rough wait estimate.
- **Leave queue**: employee can leave/cancel anytime before being assigned.
- **Notifications**: push, SMS, and email options when assigned a charger.
- **Claim timer**: 60-minute countdown; auto-forfeit and reassign if not claimed.
- **Stale session expiry**: any active charging session (forgotten check-out) automatically expires and frees the charger at the end of the calendar day.
- **Check-in**: marks charger as occupied, linked to that employee.
- **Check-out**: manual action by employee; frees the charger and advances the queue.
- **Queue display**: real-time view of position for everyone waiting.

## 8. Decisions (formerly open questions)
- **Claim timer**: 60 minutes.
- **Forgotten check-out**: no manual fallback needed — any session auto-expires and frees the charger at the end of the calendar day.
- **Locations**: 2 charger spaces, single lot.
- **Auth**: employees log in with an account (email/password or company SSO — TBD which). Joining, claiming, checking in, and checking out are all tied to an authenticated employee identity.

## 9. Success Metrics
- Reduction in average wait time per charger session.
- % of assignments claimed within the timer window (vs. forfeited).
- Charger utilization rate (time occupied vs. idle).

## 10. Risks
- A forgotten check-out can block a charger for up to a full day before it auto-expires, which is a meaningful chunk of lost availability given there are only 2 spaces.
- FIFO-only may feel unfair to employees with very low battery vs. others topping off.
