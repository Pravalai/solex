# Demo walkthrough (10–15 minutes)

Before the session: `npm run demo:reset && npm run dev`, then open http://localhost:3000. Use two browser windows (one normal, one private) so two personas can be signed in at once. Password for every persona: `demo1234`.

## 1. The mandate lens (Neha Kapoor, management): 2 min

1. Sign in as **Neha Kapoor** → *Command centre*.
2. Point out the **Mandate health** table: absorption against the pace marker, days left, soleX fee, channel cost and **net margin per mandate**. *Aravali Courtyard* has 40 days left and is behind pace; *Meridian Skyline* is at risk.
3. The **Needs attention** rail: one discount waiting for soleX, one waiting for the developer, overdue collections, a refund due after a cancellation.
4. Click *Aravali Greens* → the **stacking plan**. Green is available, amber is on hold (lock icon = locked pending approval), blue booked, navy sold, grey blocked by the developer. **Tower C is hatched: retained by the developer, outside the mandate.** The mandate panel shows the commercial terms that drive everything else.

## 2. A partner introduces a buyer (Rohan Desai, Prime Estates): 2 min

1. In the second window sign in as **Rohan Desai** (resize to phone width to show it is mobile-first).
2. Home → *Register a customer*: Aravali Greens, any name, a new 10-digit mobile → **Register**. Note the protection message.
3. *My customers* shows the new registration with the soleX relationship manager it was assigned to and the protection window.
4. *Duplicate protection:* sign out, sign in as **Ishita Sen (UrbanKey)**, and register *Aditi Sharma, 98100 12345* on Aravali Greens. She is told the customer is **already registered, but not by whom**.

## 3. Sales exec works the lead and books (Arjun or Sara): 4 min

1. In the first window sign out and sign in as the exec named on Rohan's lead (Arjun Mehta or Sara Thomas).
2. *My leads* → open the new lead. Note the **attribution card** (Prime Estates, protected until …).
3. Log a call → schedule a site visit → mark it completed with feedback. The stage moves automatically: Contacted → Visit planned → Visit done.
4. **Pick a unit to book** → booking mode on the stacking plan → click an available unit in tower A.
5. In the drawer, type a discount of about 4.5% of list price: the preview says **soleX management, then the developer, must approve**. Book it. The booking page shows *Awaiting soleX approval*, and the unit is locked on the plan.
6. *Optional, double booking:* open the same available unit in both windows (as Arjun and Sara), book in one, then try in the other: **"changed since you opened it"**, and nothing is written.

## 4. Two-level approval: 2 min

1. **Neha** → *Approvals* → approve. It moves to *waiting for the developer*.
2. Sign in as **Meera Iyer (Aravali Habitats)** → *Approvals* → approve.
3. Back on the stacking plan, the unit is **booked**; the booking now has a 5-instalment schedule and three accrued commission lines.

## 5. Money in, commission earned (Vikram Rao, finance): 2 min

1. Sign in as **Vikram Rao** → open the booking (from *Bookings*).
2. Record instalment 1 (the amount is pre-filled) with any UTR, then instalment 2. On crossing **20% collected** the booking reaches *Agreement stage*, the unit turns **sold**, and the commission lines become **earned**.
3. Try the same UTR again: rejected as a duplicate.
4. Raise the soleX fee invoice from the ledger. Show *Collections & commission*: approving partner payouts is management's step; paying is finance's.

## 6. Everyone sees the same truth, through their own lens: 2 min

1. **Rohan (partner)** → *Brokerage*: the new line, "Earned: awaiting approval". No soleX fee anywhere.
2. **Meera (developer)** → *Portfolio* → Aravali Greens: the booking shows as "Channel partner" with collections and the fee owed to soleX, but **no partner name and no brokerage**. Download the **MIS CSV**.
3. **Neha** → *Command centre*: absorption is up by one and the attention rail has cleared. Then *Activity & integrity*: the full audit trail of what just happened, the **simulated WhatsApp/email outbox**, and **all 6 integrity checks passing**.

## 7. If time allows: cancellation

As Neha, open a booking at agreement stage → **Cancel booking**. The unit returns to available, open instalments are cancelled, unsettled commission is reversed, settled commission gets a clawback line, and the refund due is computed under the mandate's forfeiture term. The integrity checks still pass.
