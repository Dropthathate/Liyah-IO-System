# Dakota xPaws — art corner

A small, framework-free artist site built with plain HTML, CSS, and JavaScript. It lives in its own directory so it does not replace the existing site at the repository root. The project has no build step, no server-side code, and no form that collects personal information.

## Deploy this folder with Vercel

1. Import the GitHub repository `Dropthathate/Liyah-IO-System` into Vercel as a **new project** (or use a separate project for this site).
2. Set **Root Directory** to `dakota-art-site`.
3. Select **Other** as the framework preset. Leave the build and install commands empty; set the output directory to `.` if Vercel asks for one.
4. Deploy. Future pushes to the repository can trigger new deployments for the folder.

For a local preview, open `index.html` in a browser or run `python3 -m http.server 8000` from this directory and visit `http://localhost:8000`.

## Content notes

- Video covers and outbound links point to Dakota's public YouTube channel and videos; no stock illustrations are used as stand-ins for her art.
- The channel and video thumbnails are loaded from YouTube. A network connection is needed to display them.
- Edit the text and video IDs in `index.html` to update the featured projects. The CSS doodles are decorative and can be changed independently.
- The site intentionally has no public email address, contact form, location, analytics, or embedded autoplay video.
