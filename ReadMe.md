## What is HitchPay? (Layman’s Summary)

Imagine a digital engine that powers a modern bank. HitchPay is that engine. It is a **Financial Technology (FinTech)** platform that allows people and businesses to move money across borders, pay bills, and manage digital wallets.

Because it handles money, the code is designed with "safety locks" (security) and "memory" (logging) to ensure every kobo or cent is accounted for.

---

## What’s Happening Inside? (The Core Features)

### 1. Digital Wallets & Multi-Currency

The system manages user wallets that can hold different currencies like **NGN, USD, GBP, and KES**. It tracks balances and allows users to convert money between these currencies.

### 2. Banking & Card Services

* **Virtual Cards**: The app can talk to card providers to create digital debit cards for online shopping.
* **Account Generation**: It automatically creates bank account numbers for users through partners like Providus Bank.

### 3. "Smart" Background Workers (Cron Jobs)

The system has "robots" (called **Cron Jobs**) that run in the background even when no one is using the app:

* **Webhook Retries**: If a payment notification fails to reach a merchant, this job tries again every 5 minutes until it succeeds.
* **Inactive User Notifier**: It checks for users who haven't logged in for a while and sends them a friendly reminder.

### 4. Communication & Security

* **WhatsApp & SMS OTPs**: To keep accounts safe, the system sends one-time passwords via WhatsApp and SMS using providers like Twilio.
* **Identity Verification (KYC)**: It integrates with services like **Veriff** to check ID cards and faces to prevent fraud.

---

## Project Organization (The "Map")

To keep things organized, the code is split into specific "departments":

* **`controllers/`**: These are the **Managers**. When you click "Send Money," a controller is the manager that makes sure the recipient is real and you have enough balance.
* **`routes/`**: These are the **Receptionists**. They receive requests from the mobile app and direct them to the right "Manager" (Controller).
* **`models/`**: This is the **Filing Cabinet**. It defines how data (like a user's name or a transaction amount) is saved in the database.
* **`auth/`**: This is the **Security Guard**. It checks "ID Badges" (Tokens) to make sure hackers can't access your private information.
* **`migrations/`**: These are the **Construction Blueprints**. They tell the database how to build or change its tables.

---

## Technical "Power Grid"

For the developers, here is the technology stack powering the site:

* **Server**: Node.js & Express.
* **Database**: MySQL (using Sequelize to talk to it).
* **Speed Booster**: Redis (used to make the app feel instant).
* **Monitoring**: New Relic (this alerts the team if the "engine" starts smoking or running slowly).

---

## How to Use This Repo

1. **Environment Setup**: Copy your secrets into a `.env` file (Database keys, API keys for Stripe/Twilio).
2. **Install Tools**: Run `npm install` to get all the necessary software packages.
3. **Start the Engine**:
* For daily work: `npm run dev`.
* For the real world (Production): `npm start`.