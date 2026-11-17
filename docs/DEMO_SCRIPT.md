# soleX demo script

**Setup:** `npm run demo:reset && npm run dev` → <http://localhost:3000>. Use two browser windows (one private) so two personas can be signed in side by side. On the login page, click a persona to sign in. Every persona's password is `demo1234`.

**Say this first (30 seconds):**

1. Every screen opens on **what needs you now**, not on a report. Charts are still there, one tab away.
2. Every item says **why** in one line from live data. The **ⓘ** shows the exact rule that raised it. There is no AI and no black box.
3. **One record flows through the whole business:** a partner registration becomes the lead, the booking changes inventory, a receipt makes commission due. Nothing is typed twice.

| Persona | Role | Lands on | Their job |
| --- | --- | --- | --- |
| Neha Kapoor | soleX Management | Command centre | Decide: discounts, slipping mandates, money that is stuck |
| Arjun Mehta, Sara Thomas, Rohit Kulkarni | soleX Sales | My leads › Today | Turn leads into bookings |
| Vikram Rao | soleX Finance | Finance › To do | Collect, invoice, pay |
| Rohan Desai (Prime Estates), Ishita Sen (UrbanKey) | Channel partner | Partner home | Register buyers, track them, see brokerage |
| Meera Iyer (Aravali Habitats) | Developer | Portfolio | Watch sales, approve large discounts, download the MIS |

---

## Part A: The live walkthrough (about 12 minutes)

### Act 1. Neha decides (2 min)

| Click | What happens | Pain it solves |
| --- | --- | --- |
| Sign in as **Neha** | Opens on the *Command centre*: 4 numbers, then **Needs your decision**, then one card per mandate | Management no longer has to read a dashboard to work out what to do |
| Point at the **4 KPI cards** (each one is a link) | Units sold vs target · Collected (overdue in red) · Net margin · Booked this month | These are the four questions a director asks first. Each card links to its detail screen |
| On the discount row (*"Discount 2.5% on A-1001 · Aarav Das"*), click **Approve** → **Approve discount** | 2.5% is within soleX's own band, so the booking is confirmed at once. The payment schedule and commission lines are created, the unit lock becomes *Booked*, and the customer, developer and partner are notified (simulated) | Discount sign-off without opening a file or chasing anyone. The unit was locked while it waited, so nobody else could sell it |
| Read the **mandate pace** row (*"Aravali Courtyard: 18 more bookings needed in 40 days, 3.1 a week…"*) → **Review hot leads** | Opens Leads filtered to that project's leads at visit done or negotiation | Turns "behind target" into a number per week and the leads that could close |
| Read **"₹… of soleX fee held up by late payments"** → **See and chase** | Opens Finance's list. These are overdue instalments that, once paid, cross the collection point at which the mandate makes soleX's fee billable | Shows cash soleX cannot invoice yet. Only a system that knows the mandate terms can raise this |
| Read **"Arjun Mehta: 20 overdue follow-ups"** → **Review & reassign** | Opens that exec's overdue leads | Spots a sales exec who is overloaded before their leads go cold |
| Point at the **Mandates** cards on the right | Gold bar = units sold, tick = where sales should be today, plus a health pill, days left, collected and net margin | Mandate health at a glance across all projects |
| Click the **Performance** tab | Booking trend, lead funnel, lead sources, partners, sales team | The analytics are kept for reviews, just not on the first screen |

### Act 2. A partner brings a buyer (2 min)

| Click | What happens | Pain it solves |
| --- | --- | --- |
| Second window: sign in as **Rohan** (narrow the window to phone width) | Partner home: *Register a customer*, *Latest on your customers*, and a one-line brokerage summary | Partners work from their phones. They want two answers: what happened to my customer, and when do I get paid |
| Fill in the form (project, name, a new 10-digit mobile) → **Register customer** | A lead is created with source = this partner and protection for the mandate's window (90 days on Aravali Greens). It is auto-assigned to the allocated sales exec with the fewest open leads, who gets a WhatsApp (simulated) | No re-keying: the partner's form is the lead. Attribution is timestamped, which settles "who brought this buyer" disputes |
| **My leads** → on a card that reads *"soleX: Arjun Mehta"*, click **Request site visit** → pick a slot → **Send request** | A visit request is created, the exec is notified, and it appears at the top of Arjun's *Today* list | Partners can push a deal forward without phoning the sales team |
| Sign out (icon next to the name) → sign in as **Ishita (UrbanKey)** → register *Aditi Sharma, 98100 12345* on Aravali Greens | Refused: *"already registered"*, with no hint of who holds the customer | Protects the first partner, and leaks nothing to a competitor |

### Act 3. The exec works the day (4 min)

| Click | What happens | Pain it solves |
| --- | --- | --- |
| First window: sign in as **Arjun** | *My leads* opens on **Today**. The line above the list shows open leads, overdue follow-ups and visits in the next 3 days | The exec does not have to decide whom to call. The system ranks the day |
| Walk down the list (red dot = urgent, amber = soon, grey = later) | **Partner asked for a visit** · **new partner lead, called within 24 h?** (the partner was promised a call) · **agreed to visit on your call, none scheduled** · **visited, no booking: best-fit unit** · **overdue follow-ups, leads closest to booking first**. Leads untouched for 30+ days are one clean-up row | Promises made to customers and partners are not forgotten |
| On Rohan's request: **Confirm visit** → keep or change the slot → **Confirm & notify** | Visit is scheduled, lead moves to *Visit planned*, customer and partner get WhatsApps (simulated). Rohan's feed will show it | The partner-to-exec handoff takes one click instead of a phone call |
| On a row with **Call**, click **Call** | The call dialog rings, connects and plays a live transcript. **Skip to end** saves time; **End call** hangs up early | Calls are made and logged from soleX with the number masked. Say clearly: **simulated**, no telephony or AI |
| Read the outcome | Sentiment, interest score (1 to 5), the best signal, the main concern, and **one Next step with its button** | Turns a call into the action that follows it, not just a note |
| Press the next-step button: **Schedule visit**, or **Send on WhatsApp** (editable template draft), or note the call-back already booked. If shown, click **Mark qualified** | The visit is booked, or the message goes to the simulated outbox and is logged, or the stage moves to *Qualified* | Follow-up happens while the call is fresh, and every step leaves a record |
| **Done** | The dialog closes. The row in Today has already changed to reflect the call | The list stays current without a reload |
| On a *"Visited … Book T1-801"* row, click **Book T1-801** | The unit drawer opens with the lead already selected | No hunting through the floor plan for a suitable unit |
| Enter a discount larger than the band in the preview (e.g. 4%) → **Book T1-801 for …** | Preview: *needs soleX management, then developer approval*. The booking is created, the unit is locked (shows on hold, with a lock), and Neha's list gets the approval | Discount leakage is controlled by mandate rules, with no side deals |
| *Optional:* open the same available unit in both windows (Arjun and Sara) and book in each | The second booking gets *"changed since you opened it"*, and nothing is written | Double booking is impossible, enforced in the database as well as the screen |

### Act 4. Two-level approval (1 min)

| Click | What happens | Pain it solves |
| --- | --- | --- |
| **Neha** → Command centre → **Approve** on the new discount | Above soleX's band, so it moves on to the developer. The row becomes *"waiting on Aravali Habitats"* | soleX endorses what it is allowed to; the developer keeps control above that |
| Sign in as **Meera** → **Approvals** (badge in the top menu) → **Approve** → **Approve discount** | Booking confirmed: unit *Booked*, 5-instalment schedule, 3 commission lines (soleX fee, partner brokerage if any, exec incentive) | The developer approves in their own portal, with an audit trail instead of email threads |

### Act 5. Finance clears its list (2 min)

| Click | What happens | Pain it solves |
| --- | --- | --- |
| Sign in as **Vikram** | *Finance › To do*: overdue collections first, then fee invoices to raise, then approved payouts to pay | Finance works in order of money at stake, not by browsing ledgers |
| Read a red row: *"Paying it crosses the 20% trigger: unlocks ₹6.8 L fee and ₹3.9 L payouts"* | | Shows why this receipt matters more than the others |
| **Record payment** → amount is pre-filled → enter any UTR → **Save receipt** | Allocated to instalments in due order; customer receipt WhatsApp (simulated). If it crosses the trigger, the booking reaches *Agreement*, the unit turns *Sold*, commission becomes *Earned*, and a new **Invoice Aravali Habitats** row appears | Collection, inventory and commission stay in step automatically |
| Try the same UTR again on that booking | Rejected as a duplicate | No double-counted receipts |
| **Send reminder** on another row | A WhatsApp reminder goes to the outbox (simulated) and the row shows *"Reminded today"*. At most one per instalment per day | Chasing payments without spamming customers |
| **Raise invoice** → invoice number → **Save** | The fee line moves to *Invoiced*; next it shows **Mark received** | Tracks the receivable from soleX's fee through to cash |
| Point at *"₹… in payouts awaiting management"* | Finance cannot approve payouts; only management can | Separation of duties: one person approves, another pays |

### Act 6. Same truth, different lenses (1 min)

| Click | What happens | Pain it solves |
| --- | --- | --- |
| **Rohan** → Home | Feed shows *"Site visit scheduled"*; **Brokerage** shows *"Earned: awaiting approval"* lines. No soleX fee anywhere | Partners see progress and payout status without calling soleX |
| **Meera** → Portfolio → **Open project** | Bookings show channel *"Channel partner"*, never the partner's name or brokerage | Confidential commercial terms stay separated between parties |
| **Meera** → **MIS (CSV)** | Downloads the project MIS. The download is audit-logged | Ready-made developer reporting instead of a monthly spreadsheet exercise |
| **Neha** → **Audit & integrity** | Integrity summary *"All 7 checks pass"* · audit trail of everything just done · **Notification outbox** with every WhatsApp, reminder and confirmation from this demo | Every action is traceable, and the books can be proven consistent |

### Act 7 (optional). Cancellation

| Click | What happens | Pain it solves |
| --- | --- | --- |
| **Neha** → Bookings → a *Live* booking at Agreement stage → **Cancel booking** → reason → confirm | Unit back to *Available*; open instalments cancelled; unearned commission reversed, paid commission gets a clawback line; refund computed after forfeiture (2% on Aravali Greens). The refund then appears in both Neha's and Vikram's lists | Cancellations unwind correctly across inventory, money and commission |

---

## Part B: Every button, and why it exists

### Everywhere
| Element | What it does | Why it exists |
| --- | --- | --- |
| Persona buttons on login | One-click sign-in as a demo user | Demo only; production would use real accounts |
| Yellow banner at the top | States that the data is fictional and messages and payments are simulated | Honesty about what is real |
| **ⓘ** next to an item | Shows the rule that raised it | Every suggestion can be explained and audited |
| Red / amber / grey dot | Urgent / soon / later | Scan priority without reading |
| **Show all N** | Expands a task list beyond its first 8 (10 on Finance) | Keeps the first view short |
| Sign-out icon | Ends the session | |
| Hover over any ₹ amount | Shows the exact figure | Compact figures like ₹1.2 Cr on screen, exact rupees on demand |

### Command centre (management)
| Button | What it does | Why it exists |
| --- | --- | --- |
| **All mandates ▾ · Apply** | Limits KPIs and mandate cards to one project | Drill into one mandate for a developer review |
| KPI cards | Link to Projects, Finance, the commission ledger and Bookings | Drill-down from every number (brief §3) |
| **Overview / Performance** | Overview = decisions; Performance = trend, funnel, sources, partners, team | Action first, analysis on demand |
| **Approve / Reject** (discount row) | Approve: confirms the booking, or forwards it to the developer if above soleX's band. Reject (reason required): releases the unit, tells the exec | Pricing control without leaving the screen |
| **Review hot leads** (pace row) | Opens that project's leads at visit done or negotiation | Act on a slipping mandate |
| **See and chase** / **Send reminder** (fee held up) | Opens the Finance list, or reminds the customer directly | Free the fee soleX cannot yet invoice |
| **Review & reassign** (exec backlog) | Opens that exec's overdue leads | Rebalance work before leads go cold |
| **See leads** (partner protection ending) | Partner leads losing protection within 7 days with no visit | Prevent brokerage disputes |
| **Open booking** (refund due, waiting on the developer) | Opens the booking | Context for the decision |
| Mandate card name | Opens the project and its stacking plan | |
| Sales team card (Performance tab) | Opens that exec's leads | |

### My leads (sales; management sees the Pipeline only)
| Button | What it does | Why it exists |
| --- | --- | --- |
| **Today / Pipeline** | Task list / full table | Work the day, or search the book |
| **+ New lead** | Form for walk-ins and calls; dedupes on phone number. If the lead exists, offers to *open the existing lead* and names its owner | One record per customer per project; protects soleX's own marketing leads too |
| **Call** (row) | Opens the call dialog for that lead | Call straight from the list |
| **Schedule visit** → **Schedule & notify customer** | Books the visit the customer agreed to; customer gets a WhatsApp | Keeps the promise made on the call |
| **Confirm visit** → **Confirm & notify** | Turns a partner's request into a scheduled visit; customer and partner are notified | Partner-to-exec handoff in one click |
| **Book [unit]** | Opens the best-fit unit with the lead pre-selected | Shortest path from a visit to a booking |
| **Record outcome** | Opens the lead's visits to mark completed or no-show | Visits whose time has passed must not stay open |
| **Review & send** | Opens the lead's next step with the WhatsApp draft | Information promised on a call actually gets sent |
| **Review** (clean-up row) | Pipeline filtered to overdue leads | Keep the pipeline honest |
| Pipeline tabs: **Open, Overdue, Close to booking, Protection ending** (management only)**, Booked, Lost, All** | Filter the table | |
| **Project / Owner** (management only) **/ Source / search · Filter** | Narrow the table | Find a lead fast |

### Lead page
| Button | What it does | Why it exists |
| --- | --- | --- |
| **Call [name]** | Simulated click-to-call (see Call dialog) | Every call is logged and analysed |
| **Book a unit** (Qualified, Follow-up, Visit done or Negotiation only) | Stacking plan in *booking mode* for this lead | Booking starts from the lead, so attribution carries through |
| **Next step** panel | The last call's suggested action, shown until it is done | Nothing promised on a call is dropped |
| **Schedule visit** / **Send on WhatsApp** (in the panel) | Books the visit / sends the template message (simulated) and sets a follow-up 2 days out | One click from insight to action |
| **Note ▾ · Log** | Logs a note, WhatsApp, meeting, email or outside call. Anything except a note counts as contact | A complete timeline, even for touches outside soleX |
| Call card → **Summary, all insights and transcript** | Full summary, every insight with the customer's words, the transcript | Managers can review calls; coaching on how much the exec talked |
| **Units that fit → Book** | Up to 3 available units in the preferred configuration, within budget + 5% | Pitch the right unit first. Shows *"Qualify to book"* if the stage is not yet bookable |
| **Confirm** (requested visit) | Confirms the partner's slot | |
| **Record outcome → Completed** (feedback + interest 1–5) / **Customer did not come** | Moves the lead to *Visit done* (follow-up in 2 days) or back to *Follow-up* | Visit results drive the next stage automatically |
| **Schedule** (site visit) | Books a visit; customer WhatsApp; lead moves to *Visit planned* | |
| **Change stage or owner → Update stage** | Manual stages only: Contacted, Qualified, Follow-up, Negotiation, Lost (reason required), Invalid | Visit and booking stages are set by the system and cannot be faked |
| **Reassign** (management only) | Moves the lead to another exec allocated to that project; new owner gets a WhatsApp | Controlled reassignment, with an audit trail |

### Call dialog
| Button | What it does | Why it exists |
| --- | --- | --- |
| **Skip to end** | Fast-forwards the scripted conversation | Demo speed |
| **End call** | Hangs up; only what was said up to that point is analysed and logged | Mirrors a real call |
| **Call again** (after no answer) | Retries. A missed call has already logged a missed-call SMS and a follow-up for tomorrow | Unanswered calls still leave a trace |
| **Mark qualified** (interest 4/5 or more on a new or contacted lead) | Moves the lead to *Qualified* | Qualify on evidence from the call |
| **Full summary and all insights** | Expands the detail | Short by default |
| **Done** | Closes the dialog; the call is already on the timeline | |

### Projects & inventory
| Button | What it does | Why it exists |
| --- | --- | --- |
| Project card | Opens the stacking plan | |
| Unit cell (green available · amber hold, with a lock if awaiting approval · blue booked · navy sold · grey blocked · hatched = retained by the developer) | Opens the unit drawer | Live, unit-level inventory; retained units are visibly outside the mandate |
| **Exit booking mode** | Leaves booking-for-a-lead mode | |
| **Hold while I close with the customer** | Reserves the unit for the mandate's hold time (45 min on Aravali Greens) with a countdown; it lapses automatically | Stops two execs promising the same unit, without blocking it for good |
| **Release hold** (your own hold, or management) | Frees the unit | |
| Lead picker + **Discount** + **Book [unit] for [name]** | Creates the booking. The live preview shows: within exec band → confirmed at once; above → management; above the mandate band → management, then developer | Discount authority comes from the mandate |
| Booking link in the drawer | Opens the live booking on that unit | |

### Bookings
| Button | What it does | Why it exists |
| --- | --- | --- |
| **Live / Awaiting approval / Cancelled / All** | Filter | |
| **Approve discount / Reject** (management, booking pending soleX) | Same as on the command centre | |
| **Cancel booking** (management) | Releases the unit, cancels open instalments, reverses or claws back commission, computes the refund after forfeiture | Correct unwinding everywhere at once |
| **Record payment** (finance) | Amount, mode, UTR → allocated to instalments | Duplicate UTRs and overpayment are rejected |
| Commission line: **Raise invoice → Mark received** (soleX fee) | Tracks the receivable from the developer | soleX's revenue, from invoice to cash |
| Commission line: **Approve payout** (management) **→ Mark paid** (UTR) | Approves, then pays partner brokerage or exec incentive | Two people, two steps |
| Clawback line: **Issue credit note / Approve recovery / Mark recovered** | The reverse flow after a cancellation | Money already paid is recovered, not forgotten |
| **Audit trail · N events** | Every change to this booking | Who did what, and when |

### Finance (finance and management)
| Button | What it does | Why it exists |
| --- | --- | --- |
| **To do / Collections / Commission ledger** | Task list / everything due in the next 45 days plus refunds / every commission line | |
| **Record payment → Save receipt** (finance only) | Records the receipt inline | No trip into the booking |
| **Send reminder** (finance and management) | Simulated WhatsApp, at most one per instalment per day | Chase without spamming |
| **Raise invoice · Issue credit note · Mark received · Mark paid** | Next ledger step, done inline | |
| **View lines** (payouts awaiting management) | Ledger filtered to earned payouts | Finance can see them, but not approve |
| **See details** (only if an integrity check fails) | Opens Audit & integrity | No money moves on inconsistent data |
| Ledger filters: **All · soleX fee · Brokerage · Incentives** and **Earned · Invoiced · Approved** | Filter lines | |

### Audit & integrity (management and finance)
| Element | What it does | Why it exists |
| --- | --- | --- |
| **All 7 integrity checks pass** (click to expand) | Re-checks the whole database on every load: one booking per unit, lock keys, schedule total = price, receipts = payments, agreement only after the trigger, commission maths, every call logged once | Proves inventory, bookings and money agree |
| **Event type ▾ · Filter** | Filters the audit trail | |
| **Notification outbox** | Every WhatsApp, email and SMS the system would send | Shows the automation; nothing actually leaves the demo |

### Partner portal
| Button | What it does | Why it exists |
| --- | --- | --- |
| Stats line (customers · booked · brokerage) | Links to My customers / Brokerage | |
| **Register customer** | Creates a protected, auto-assigned lead | First to register owns the customer, by timestamp |
| **Request site visit → Send request** | Sends a visit request to the soleX exec (one pending per customer) | Partners move deals without calling |
| **Needs you** | Customers losing protection within 7 days with no visit, each with **Request site visit** | Protects the partner's brokerage |
| **Latest on your customers** | Last 14 days of milestones: contacted, visited, booked, brokerage earned or paid | Progress without phone calls; never internal notes |
| **Projects → project** | Live availability (who holds a unit is hidden), price list, payment plan | Partners only see inventory they are appointed to |
| **My customers** | Each customer's stage, soleX contact, visit, protection days left, booking | |
| **Brokerage** | Accruing / payable / paid, line by line, with UTRs | Payout status is transparent, which builds partner trust |

### Developer portal
| Button | What it does | Why it exists |
| --- | --- | --- |
| **N discount approvals waiting** / **Approvals** | Discounts above the mandate band, already endorsed by soleX | The developer keeps the final word on pricing |
| **Approve → Approve discount** / **Reject** (reason) | Confirms the booking (schedule issued, fee starts accruing) / releases the unit | |
| **Open project** | Full inventory including retained units, mandate terms, bookings (channel only), soleX fee statement | Developer visibility without seeing soleX's internal data |
| **MIS (CSV)** / **Download MIS (CSV)** | Project MIS export; audit-logged; protected against spreadsheet formula injection | Replaces the manual monthly MIS |

---

## Part C: Questions they will ask

| Question | Answer |
| --- | --- |
| Is this AI? | No. Every task, insight and next step comes from a fixed, named rule (hover the ⓘ) and is unit-tested. The call analysis returns the same shape an LLM would, so a model can slot in later (see REPORT §12). |
| Is the calling real? | Simulated: the conversation is generated from the lead and project. Going live means cloud telephony, speech-to-text and an LLM. Costs are in REPORT §12. |
| Why is a unit only *Sold* after 20% is collected? | Because soleX's fee is earned on money received, not on paper bookings. The trigger is set per mandate. |
| Why can't management record payments, or finance approve payouts? | Separation of duties: the person who approves money is never the person who pays or receives it. |
| Why doesn't a partner learn who already holds a customer? | That would leak a competitor's pipeline. They are told only that the customer is already registered. |
| Why can't the developer see the partner's name or brokerage? | soleX's channel costs are confidential. The developer sees "Channel partner" and their own fee. |
| What if two execs book the same unit at the same moment? | One succeeds. The other is told the unit changed, and nothing is written. This is enforced by a unique database key, not just the screen. |
| Are the WhatsApps actually sent? | No. They go to the outbox on *Audit & integrity*. Real delivery would use the WhatsApp Business API through the same outbox. |
