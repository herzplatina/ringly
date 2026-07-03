This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## About Ringly

Ringly is an AI receptionist platform sold to high-end salons, tax consultants, and other small businesses. It provides a dedicated phone number backed by a voice AI agent that answers calls, discusses services and pricing, and books appointments into the business's calendar.

### Who it works for

Ringly currently only works for businesses that meet **all** of the following criteria:

1. **They use Google Calendar for their scheduling.** Appointments are booked and synced through the Google Calendar API.
2. **They operate in the Pacific Time Zone.** All availability and booking logic assumes Pacific Time.
3. **Their menu of services is extractable from their Google (website) listing.** Onboarding auto-enriches the business by crawling its Google website to build the service menu.

## Roadmap / To-Do

- [ ] **Check Google Calendar for conflicts before booking.** Before creating a new appointment, first query Google Calendar for any conflicting appointments in the requested time slot and refuse/re-offer if the slot is already taken.
- [ ] **Enrich the calendar appointment description.** The calendar event description should include the customer's name, email, and the service they requested.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
