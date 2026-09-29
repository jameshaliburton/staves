---
title: "Your data in the beta"
description: "What Staves keeps during the private beta, which services handle it, and how to have it removed."
---

This is the plain account of what happens to your data while Staves is in private beta. If anything
here changes, this page changes first.

## What we keep

- **Your email address**, to sign you in and to write to you about the beta.
- **What you tell us when you ask to join**: the description of the workflow you want to explore.
- **Your boards** and their full history of changes, including anything a coding agent writes to them.
- **Your feedback**: what you wrote, the board and page you were on, your window size, and a
  screenshot if you chose to attach one.
- **Your agent connections**: their names, permissions and when they were last used. We store a hash
  of each credential, never the credential itself.

We never see your repository. A coding agent reads your code on your machine and sends only its
description of the work.

## Who handles it

| Service | What it does | What it sees |
|---|---|---|
| Supabase (EU, Stockholm) | Database, sign-in and file storage | Everything listed above |
| Vercel | Hosts Staves | Requests as they pass through, and short-lived logs |
| Resend | Sends email | Your address and the messages we send you |
| Slack | Tells the Staves team when something needs a person | Your email, what you wrote when asking to join, and the text of your feedback. Never your boards. |
| Langfuse | Lets us see how Staves' browser conversations perform | Which board and model, timings, sizes and errors. Not what you said. |
| Your AI provider | Only if you add your own key for browser interviews | The conversation, sent with your key to the provider you chose. We do not keep the key. |

We do not sell your data, show you advertising, or use your boards to train models.

## Having it removed

Reply to your invitation email, or use **Feedback** in the app, and ask. We delete your account, your
boards, your feedback and the Slack messages about you, and confirm when it is done. You can revoke
an agent connection yourself at any time under **Account → Coding agents**.

This notice covers the private beta. It is not a full set of terms, and there will be proper ones
before Staves is generally available.
