# SSO

Sign in to outside services such as Claude with your Box account. The Box acts as the team's SAML identity provider, entirely behind its own address, so nothing has to be exposed to the internet.

## Highlights

- One sign-in for Claude Team and Enterprise, through its WorkOS SSO setup
- Works on a private network: every SAML message travels through the person's browser
- Box users are the directory: disabling someone stops their next sign-in everywhere
- Box roles become provider groups, so admins can be mapped to admin roles
- Every sign-in and refusal is logged and available to alert rules
