# CosmixMC Hoplite Atlas

A Node.js site for browsing Hoplite Mythical and Legendary items. Visitors can browse item descriptions, images, and optional recipes or guides. Only admins can add entries.

## Run locally

```sh
npm install
export ADMIN_PASSWORD="set-a-long-random-password-here"
npm start
```

Set `ADMIN_PASSWORD` to a password at least 12 characters long (16 or more is recommended) in your shell or hosting provider's environment settings. Do not put the real password in source control. Open [http://localhost:3000](http://localhost:3000); set the `PORT` environment variable to use a different port.

Anyone can browse the archive, but creating an entry requires admin sign-in. Admin sessions use an HttpOnly, SameSite=Strict cookie and expire after 12 hours; they are cleared when the server restarts. Use HTTPS when hosting the site publicly.

Item data is stored in `data/items.json` and uploaded images in `uploads/`. Images must be PNG, JPEG, GIF, or WebP and no larger than 5 MB.
