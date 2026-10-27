---
title: Workers
roles: [system_admin]
---

# Workers

Give a worker a job in plain words, and it does the job in a web browser in the cloud while you watch. This is a prototype, so it's on no menu: go to `/workers`. Only you see your workers.

## Your workers page

At the top is what your workers have spent today. **Needs you** lists every task waiting on you, with the newest question or approval first, and you can answer each one right there. **Open task** shows the whole task. **Activity** shows each task, newest first and grouped by day: which worker, whether it's working, finished or stopped, and the latest thing it did or said. Select the worker's name to open that task. It updates by itself while a worker is working. **Your workers** below lists every worker you have.

## Create a worker

Press **New worker**, give it a name and fill in its instructions. The box starts with four headings to fill in: the **Job**, a **Checklist** of what must be true when it's done, the **Rules** it can't find out by itself (which website to use, what to skip), and the **Reply** you want. The worker reads them on every task. Then press **Create worker**.

## Give it a task

On the worker's page, type what you want under **Give it a task** and press **Start**. For example: "Search holabirdsports.com for running shoes and give me the name, price and rating of the first 3 results."

The task's page opens at once. While the worker works:

- **The browser, live** shows the page it has open, as it clicks and types.
- **What it did** lists every step as it happens.
- **Stop** ends the task straight away. It's also there while the task waits on you.

When it's finished, **What it found** shows its reply. At the bottom are how long it took, what it cost, and **Replay on Browserbase**, a recording of the browser that opens for whoever holds the Browserbase account.

A task can run for about four minutes. If it runs out of time, the worker writes up what it found so far and says what's left.

## When it needs you

A worker stops and waits for you in two cases. Each shows under **Needs you** on your workers page and on the task's page, and waits up to a day. After that the task stops, and you give it the task again.

- **A question.** When the task leaves something only you can decide, it asks. Type your answer and press **Send answer**, and it carries on. When it needs a password, the box hides what you type. The password is saved for that worker to type, and nobody can read it back, you included.
- **An approval.** Before it saves, sends or submits something on a website, it asks first. **Allow once** lets that one press go ahead. **Allow always on** the site lets it save, send and submit there from now on without asking. **Deny** stops it, and it carries on without doing it. Paying, buying, deleting, posting in public, changing who has access and accepting terms always ask, so those offer only **Allow once** and **Deny**.

Reading pages, searching and signing in never ask. If a website blocks it or asks it to prove it's human, it stops and says so. Some large sites, Amazon among them, block it.

## Teach it a task

When a task goes well, open it and press **Teach this task** under **What it found**. The worker writes up what it did as numbered steps, saved under **Skills** on its page. On later tasks like it, it follows those steps, so it gets there faster and for less. Each skill shows what the task it came from took, and the average of the tasks finished since. **Edit** changes the steps, and **Remove** deletes the skill.

## Memory, permissions and passwords

On the worker's page:

- **Memory** holds notes it reads on every task, such as which account to use or what to skip. **Add a memory**, give it a title and say what to remember. **Edit** or **Remove** any of them.
- **Permissions** has **Edit records in websites**. Switched on, it saves, sends and submits on any website without asking. The kinds that always ask still ask. **Allowed always** lists the sites you chose Allow always for, and **Remove** makes it ask there again.
- **Passwords** lists the passwords it can type, by what they're for. Add one with **Save password**, or **Remove** it. Nobody can see a saved password, you included.

## Change or archive a worker

Under **Name and instructions** on the worker's page, change either and press **Save**. The next task uses the new instructions. **Archive worker** takes it off your list. Its tasks are kept.
