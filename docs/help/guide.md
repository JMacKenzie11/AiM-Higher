---
title: When Aimee gets in touch
roles: [team_member, company_admin, system_admin, aims_guide]
---

# When Aimee gets in touch

Most of the time you go to Aimee. Sometimes Aimee comes to you.

Your company has named one person to lead its implementation of AiMS.
That person is the **AiMS champion**, and Aimee coaches them through
it. If that is you, Aimee will get in touch from time to time with
something worth your attention, as a note in your notification bar.

## What you get today

After a leadership meeting is summarised, Aimee invites the champion
to talk it through. Clicking the note opens a chat about that
specific meeting.

That is the first of these, not the whole of it. More will follow as
the implementation goes on.

## Why you got this

Your company named you the AiMS champion in company settings. It is
the only reason. Aimee is not watching how you work, scoring you, or
picking people out.

If you would rather somebody else led it, a company admin can change
the seat on the company's settings page, and Aimee follows it.

## What happens in the chat

Aimee has read the meeting summary and opens with something from it.
The conversation is about how the meeting went: what worked, where
it got stuck, whether decisions landed with an owner and a date.

Three or four exchanges is a good one. There is no form to fill in.

**Nothing is created from it.** Aimee cannot add commitments, raise
issues, or change your meeting summary from this chat. If you decide
to do something, you still do it in the usual place. If Aimee says
something back to you that sounds like it has been logged, it has
not been.

The chat is private to you, like every other conversation you start.
It appears in your Ask Aimee list afterwards.

## What Aimee looks at

Worth knowing before you reply to her, because a coach you cannot
see the edges of is a coach people hedge with.

**The meeting summary, not the recording.** Aimee reads the written
summary of the meeting and the commitments that came out of it. She
does not read the transcript. Nothing anybody said word for word is
in front of her.

**The shared record, the same as you see it.** Past commitments and
whether they were met, the scorecard trend, issues and how they were
worked, previous plans. All of it runs under your own account, so
Aimee sees exactly what you would see if you opened those pages, and
nothing you could not.

**What she remembers about you.** Ask Aimee keeps notes about your
own coaching over time. Those are yours. You can read them and
delete them at **Ask Aimee → What Aimee remembers**.

**Not other people's conversations.** Aimee cannot read anybody
else's chats, and nobody can read yours.

## Who gets these

Only the AiMS champion. One person per company.

Not the leadership team, not the people named in the meeting, not
your manager. If a commitment in the summary belongs to somebody
else, they are not told that Aimee mentioned it to you.

Your company's admins can see **that** invitations were sent and
whether they were opened. They cannot see what was said in the
chat.

## What stays private

The debrief conversation is private to you, the same as every other
conversation you start. It shows in your Ask Aimee list and nowhere
else. If you want somebody to read it, you share it deliberately,
the same way you would any other.

The record Aimee keeps of the invitation itself holds the date, the
meeting it was about, and the one line you saw in your notification
bar. None of the conversation goes into it.

## Being the champion does not change what you can see

The seat is about who Aimee works with. It grants nothing and takes
nothing away: everything you could open before, you can open now,
and nothing new has been opened to you.

## If you do not want it

Click **Not now** underneath the note. It goes away and nothing
happens.

Aimee will be in touch again after the next meeting. If you would
rather not be, ask a company admin to take you out of the champion
seat. Leaving the seat empty is a normal thing to do: nobody is
contacted and nothing else changes.

## If you miss one

Nothing is lost. Only the most recent invitation is live at any
time, so if two meetings are summarised before you get to either,
you are invited about the newer one. The older note goes quiet
rather than stacking up.

You can always open any meeting summary yourself from **Meetings**
and read it without the chat.

::: role system_admin
## For system admins: what the Guide has raised

`npm run guide:nudges -- --company <name>` lists every note the Guide
has raised for that company in the last 30 days (`--since` changes
the window, `--instance` the instance): when it was raised, which
meeting it was about, the headline the champion saw, whether it is
pending, opened, dismissed or superseded, and when that changed.
Without `--company` it shows only how many each company raised and
what happened to them, with no headlines. It signs in as you and reads
only what a system admin can see. It deliberately shows nothing of the
chat that follows a note: the debrief is the champion's own
conversation, and this command never reads it, links to it or counts
it.
:::
