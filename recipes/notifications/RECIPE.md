# Notifications

One bell for everything that needs attention, merging chat mentions and messages with alerts, and delivering alerts straight into chat rooms. It is glue between Chat and Alerts: remove it and both keep working on their own.

## Highlights

- A top-bar bell that merges chat mentions, messages and alerts into one list
- Web push and FCM device push delivery
- A chat transport so alert rules can post into a chat room
- No tables of its own

## Mobile

- Push notifications on iOS and Android through Firebase Cloud Messaging
- Tapping a push opens the screen it is about, such as the chat room
- A Settings row that says whether this device can receive pushes, and why not

## Builds on

- [Chat](../chat/RECIPE.md)
- [Alerts](../alerts/RECIPE.md)
