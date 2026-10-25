---
title: Company settings
roles: [system_admin, company_admin, aims_guide, portfolio_admin]
---

# Company settings

Everything that sets up one company, in tabs by what you came to do:

- **Company**: industry, and for AiMS, timezone, features and archiving.
- **People**: the AiMS champion and who else administers the company.
- **Planning**: roll to the next quarter, or start the strategy again after an annual planning session.
- **Connections**: Google, HubSpot, meeting transcripts and AI apps.

You only see the tabs and cards that are yours to use.

::: role company_admin
## What you can do here

- **Set the industry** on the Industry card.
- **Choose your AiMS champion** on the AiMS champion card. More on this below.
- **Connect Google and HubSpot** on the External connections card. See *External connections* below.
- **Connect your meeting recordings.** See *Connecting Google Drive* below.
- **See who else administers your company** under Assigned access, and remove an AiMS Guide.
- **Roll the quarter** on the Quarter card.
- **Start the strategy again** after an annual planning session.
:::

::: role system_admin
## What you can do here

Everything on the page:

- **Open this company** with the button under the company's name. **Archive or reactivate it** on the Archive card, on the Company tab. Once a company is archived, *Delete* appears too.
- **Set the industry, timezone and features**, and choose the AiMS champion.
- **Connect Google and HubSpot** on the External connections card. See *External connections* below.
- **Connect meeting recordings.** See *Connecting Google Drive* below.
- **See who else administers the company** under Assigned access, and remove an AiMS Guide.
- **Roll the quarter**, or **start the strategy again**.
:::

::: role portfolio_admin
## What you can do here

- **Open this company** with the button under the company's name. **Archive or reactivate it** on the Archive card, on the Company tab. Deleting a company is for system admins.
- **Set the industry, timezone and features.**
- **See who else administers the company** under Assigned access.
- **See the meeting transcript folders.**

Choosing the AiMS champion, rolling the quarter and starting the strategy again are done by the company's own admins.
:::

::: role aims_guide
## What you can do here

- **Open this company** with the button under the company's name, to work inside it.
- **Connect Google and HubSpot** on the External connections card. See *External connections* below.
- **Connect meeting recordings.** See *Connecting Google Drive* below.

Industry, the AiMS champion, the quarter and Assigned access are managed by the company's admins.
:::

::: role company_admin,system_admin,aims_guide,portfolio_admin
## External connections

The **External connections** card lists the outside systems this company has connected. Your company's admins can use it, and so can the AiMS Guides assigned to your company.

To add one, choose it under **Add a connection**. Its setup opens below. Once it's connected, it shows on the card and leaves the list.

**Google** brings in your meeting transcripts from Google Drive, and any measures read from a Google Sheet.

- **Connect Google account** asks you to sign in with Google. AiMS reads with that account, so share your transcript folders and spreadsheets with its address, as a Viewer.
- **Reconnect or switch account** signs in again, with the same account or a different one.
- **Disconnect** stops transcripts and Sheets measures coming in until you connect again.

**HubSpot** feeds Critical Success Factors from your deals. AiMS only reads; it never changes anything in HubSpot. It's in the list when your company has measures from outside systems switched on.

1. In HubSpot, a Super Admin creates a **service key**: Settings → Integrations → Service keys. Give it two read-only scopes: `crm.objects.deals.read` and `crm.schemas.deals.read`.
2. Choose *HubSpot* under *Add a connection*, paste the key into *HubSpot service key*, then click *Save key*.
3. AiMS checks the key with HubSpot before saving it. If HubSpot refuses it, or a scope is missing, nothing is saved and the card says what to fix.

**Paste the key here yourself.** Never send a key by email or in a chat, to AiMS or anyone else. Once saved, nobody can see the key again; the card shows only its last four characters.

To change keys, click *Replace key* and paste the new one. *Disconnect* deletes the saved key, and measures from HubSpot stop updating until you add one again.
:::

::: role company_admin,system_admin,aims_guide
## Connecting Google Drive

Meetings come in from Google Drive folders you connect here, under **Meeting transcripts**. The Google account itself is connected on the **External connections** card, above it.

1. On *External connections*, choose *Google* under *Add a connection*, click *Connect Google account* and sign in. That account is used for this company only, so different companies can use different Google accounts.
2. In Google Drive, share the folder your recordings are saved to with that account, as a Viewer.
3. Back here, paste the folder's address and click *Connect folder*.
4. If the folder holds meetings for more than one company, add a transcript alias: a word or phrase from the file names that marks a meeting as this company's. Capital letters don't matter.
5. Click *Check now* on the folder to bring in what's already there. New meetings come in on their own after that.

*Reconnect or switch account*, on External connections, changes which Google account is used. Each folder shows how many meetings it has brought in.
:::

::: role company_admin,system_admin
## Roll the quarter

The **Quarter** card closes the open quarter and opens the next. Every Priority that isn't complete moves into the new quarter, so nobody has to retype unfinished work. Completed ones stay in the quarter they were finished in. The card tells you how many will move before you press anything.

The label and dates are filled in for you, and you can change them. Rolling late costs nothing: commitments, measures and the weekly rhythm carry on regardless. You can also correct the open quarter's label and dates here.

## Start the strategy again

This isn't how you move to the next quarter. It's for after an annual planning session, when the team is rewriting the strategy. It archives every Focus Area, Goal and Priority so you can build again from a clean page.

Nothing is deleted. Open commitments become Operational: still open, no longer linked to a Priority. Closed ones keep their link, so past progress still shows. The card only appears when there's something to archive. To close just a few things, archive them one by one from their own pages in Goals & Priorities.

## AiMS champion

The person who will lead your company's implementation of AiMS, and who Aimee coaches through it. After each leadership meeting is summarised, Aimee invites them to talk it through. More will follow as the implementation goes on.

Anyone on the team can hold the seat. It doesn't have to be an admin: often the right person is whoever drives the work day to day.

Being champion gives no extra access, and removing someone takes none away. The seat decides who Aimee works with, and that's all.

**Nobody yet** is a normal setting. With the seat empty, Aimee has nobody to work with at your company and those invitations aren't sent.

If the champion is deactivated or moves to another company, the seat empties and the company's admins get a notification saying so.
:::

::: feature outside_assistants
## Connect AI apps

**On for every company by default.** You can switch it off here at any time. While it's off, nobody at the company can use AiMS HQ in an AI app, such as Claude or ChatGPT, not even a system admin.

When it's on, each person still decides whether to connect one, from their profile. A connected AI app reads what that person can read and can add their own commitments, issues and measure values. It can't change or delete anything. **How to connect** opens the steps for each app.

The company's admin can switch it, and so can an assigned guide or a system admin. Every change is recorded with who made it. Portfolio admins can't connect an AI app. AiMS never lets your data be used to train AI models. Once it reaches the AI app, that app's terms and privacy policy apply instead, along with your own settings there.
:::

::: feature ai_apps_off
## Connect AI apps

AI apps are switched off for this company. Tick **Let people at the company use AiMS HQ in AI apps like Claude and ChatGPT** and save to switch them back on. Every change is recorded with who made it.
:::

::: role company_admin,system_admin,portfolio_admin
## Assigned access

People who administer this company without being part of its team. The Type column tells the two kinds apart:

- **AiMS Guide**: assigned to work with this company.
- **Portfolio**: a portfolio admin with access to this company. Their access is managed across the whole portfolio, so these rows have no Remove.

They aren't on the People page, because that page is the team.
:::

::: role company_admin,system_admin
To end a guide's access, use *Remove from this company* on their row. They keep their account and any other companies they work with.
:::

::: role system_admin,portfolio_admin
## Timezone and features

**Timezone.** Every weekly and daily number is counted by the company's own clock: the scorecard, follow-through, the weekly figures. Changing the timezone changes where each day starts and ends, so counts near midnight can read differently afterwards. The last three changes are listed under the control, with who made them. Company admins and guides can't change the timezone.

**Features.** Turn parts of AiMS on or off for this company: *Execution Platform*, *Strengths*, *Success Tracking*, *External Measures*, *Meeting Facilitation Review*, *Automated Commitment Tracking* and *Classroom*. Each has a one-line description beside it. Turning one off hides it from the company's menu and keeps its data. Turning it back on brings everything back as it was.
:::

::: role system_admin,portfolio_admin
## Archiving a company

*Archive* stops the company's people signing in and hides it from company pickers. Nothing is lost, and *Reactivate* lets them sign in again straight away.
:::

::: role system_admin
Once a company is archived, *Delete* appears. It removes the company from every list in the app. There's no way to bring it back from inside the app.
:::

## Common questions

::: role company_admin,system_admin,aims_guide
**A meeting came in but went to the wrong company, or to none.** Check the alias against the file name. If no alias matches, the meeting waits on the Companies page for a system admin to send it to the right company.

**Why isn't our guide on the People page?** People is your team, and a guide isn't part of it. Guides are listed under Assigned access on this page.
:::

::: role company_admin,system_admin,aims_guide,portfolio_admin
**Why isn't HubSpot under Add a connection?** It appears only when your company has measures from outside systems switched on. Ask AiMS if you'd like it.

**Where did the Connections page go?** It's the External connections card on this page now, so everything is set up in one place.
:::

::: role company_admin
**Why can't I change our timezone?** Changing it re-dates your company's weekly numbers, so it's set by AiMS rather than inside the company. Ask your AiMS Guide if it needs changing.
:::

::: role portfolio_admin
**Why can't I change the AiMS champion or the quarter?** Those are decisions for the company's own admins.
:::
