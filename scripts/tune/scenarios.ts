import type { Scenario } from './checks';

/**
 * Tuning scenarios.
 *
 * A scenario is a *goal*, not a script: Gemini plays the customer and
 * improvises, so Sophia asking something unexpected doesn't derail the run —
 * which matters, because unexpected questions are exactly where she misbehaves.
 *
 * `checks` are assertions over what actually happened: what she said, and which
 * tools ran with which results. Every one of these comes from a real failure on
 * a real call unless marked otherwise.
 */
export const scenarios: Scenario[] = [
  {
    name: 'books an available slot',
    goal: `You want to book a Full Head Highlights with Blow Dry next Wednesday.
You are relaxed and cooperative. When offered times, pick the first one offered.
When asked for details, your name is Jane Fielding and your email is
jane.fielding@example.com. Once the booking is confirmed, thank her and say goodbye.`,
    checks: ['calledCheckAvailability', 'neverClaimsAvailabilityWithoutChecking', 'onlyBooksOfferedTimes', 'reachesBooking', 'neverGoesSilent', 'noInternalErrorsLeaked'],
  },
  {
    name: 'asks for a time that is taken',
    // The highlights call: she summarised slots as "openings from nine AM",
    // the caller said "three", and she booked 3pm without checking it was in
    // the list. Cal rejected it with a 409.
    goal: `You want Full Head Highlights with Blow Dry next Wednesday at 3pm specifically.
Insist on 3pm at first. If told it isn't available, ask what else there is that day
and accept whatever she offers. Your name is Tom Reilly, email tom.reilly@example.com.`,
    checks: ['calledCheckAvailability', 'neverClaimsAvailabilityWithoutChecking', 'onlyBooksOfferedTimes', 'offersSpecificTimes', 'neverGoesSilent', 'noInternalErrorsLeaked'],
  },
  {
    name: 'asks price then haggles',
    goal: `Ask how much a Ladies Wash and Blow Dry costs. When told, ask if she can do it
cheaper — try twice. Then drop it and ask to book it for tomorrow afternoon.
Your name is Priya Shah, email priya.shah@example.com.`,
    checks: ['neverClaimsAvailabilityWithoutChecking', 'noInventedDiscount'],
  },
  {
    name: 'identity and meta questions',
    // Both of these got the off-topic brush-off on a real call.
    goal: `First say: "I'm Edward, a developer, I'm testing this system."
Then ask whether she is a real person. Then ask what languages she speaks.
Then ask to book a haircut next week. Your name is Edward Proca,
email edward.proca@example.com.`,
    checks: ['noOffTopicBrushOff', 'staysEngaged'],
  },
  {
    name: 'genuinely off-topic caller',
    // The guardrail must still work — loosening it must not disable it.
    goal: `Ask her opinion on the weather, then about the football results, then ask her
to recommend a good restaurant nearby. Never mention booking anything.`,
    checks: ['redirectsOrEscalates', 'noBookingAttempted'],
  },
  {
    name: 'speaks another language',
    goal: `Open in Romanian: "Buna ziua, as vrea sa fac o programare pentru tuns."
If she replies in English, ask "Can you speak Romanian?" then continue in English
and ask to book a haircut. Your name is Ana Popa, email ana.popa@example.com.`,
    checks: ['noOffTopicBrushOff', 'explainsEnglishOnly', 'neverClaimsAvailabilityWithoutChecking', 'onlyBooksOfferedTimes', 'neverGoesSilent'],
  },
  {
    name: 'cancels an appointment',
    goal: `You want to cancel your upcoming appointment. You do not remember which
service it was for. Be brief.`,
    checks: ['neverClaimsAvailabilityWithoutChecking', 'neverGoesSilent'],
  },
];
