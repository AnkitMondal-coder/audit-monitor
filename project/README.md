# Welcome to my project

## Project info

My project is a rule-based Audit Monitor System designed to support auditors by identifying potentially risky transactions.

The application is built using React with TypeScript for the frontend, while Supabase is used for authentication, database, and backend services.

Users upload or enter transaction data, and the system evaluates each record against predefined audit rules, such as duplicate transactions, threshold violations, and unusual patterns.

Based on these rules, each transaction is assigned a risk level like Low, Medium, or High, which helps auditors quickly prioritize what needs review.

I focused on designing the business rules, data flow, and validation logic, ensuring that the system is explainable, transparent, and easy to extend with new audit rules in the future.

🏗️ System Architecture

1.Input Layer – Collects inputs as excel or csv file

2.Rule Engine – Applies predefined rules and conditions

3.Evaluation Layer – Matches events against rules

4.Alert & Reporting Module – Generates alerts and audit reports

5.Storage Layer – Stores logs, violations, and audit history

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- Tailwind CSS


**URL**: https://audit-monitor.vercel.app/dashboard 

## How can you edit this code?

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. 

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```
