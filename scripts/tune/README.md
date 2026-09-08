# Prompt tuning harness

```bash
npm run tune                     # all scenarios, voice register
npm run tune -- --channel sms    # text register
npm run tune -- --only haggle    # scenarios matching a name
npm run tune -- --verbose        # tool args, full results, raw logs
```

## What it is

Gemini plays the caller against the **real** system prompt and the **real**
tools, then asserts on what happened. A full scenario takes about 15 seconds and
costs a fraction of a penny, which is the whole point: before this, testing a
prompt change meant ringing the number and hoping to reproduce the bug.

It is not a chat. `/sophia-sandbox` is the chat. This exists to run the *same*
situation before and after a change and compare.

## Why goals, not scripts

Each scenario is a goal ("you want highlights next Wednesday at 3pm, insist at
first"), not a fixed list of lines. A script walks straight past the interesting
failures, because when Sophia misbehaves she asks something the script didn't
anticipate and the canned reply no longer fits.

## What's real and what isn't

Real: the system prompt, every tool, Cal.com availability, the salon's services,
workers and FAQs.

Stubbed: `book_direct` and `book_appointment`. Nothing reaches a calendar and no
client is emailed. The stub still rejects calls with missing arguments, because a
credulous stub hid the agent booking with `undefined` service, date and time.

Each scenario gets its own caller number in the unallocated `+44 7000 0xxxxx`
range. Sharing one leaked state between scenarios through `update_client_profile`
— Sophia greeted the Romanian caller by a name from an earlier run — and it keeps
a stray `cancel_booking` away from real clients.

## Adding a scenario

Add to `scenarios.ts` with the checks it should satisfy. Prefer scenarios drawn
from real calls that went wrong; the comments there record which failure each one
came from. New assertions go in `checks.ts` — a check returns `null` when it
passes and a one-line reason when it fails.
