# create-vergekit

Create a new [VergeKit](https://github.com/vergekit/vergekit) app.

```bash
npm create vergekit@latest my-app
```

Use the current directory:

```bash
npm create vergekit@latest .
```

## What It Does

- Downloads a tagged `vergekit/vergekit` release from GitHub.
- Uses the latest GitHub release for `npm create vergekit@latest`.
- Uses matching tag `vX.Y.Z` when you install `create-vergekit@X.Y.Z`.
- Copies the template into the target directory.
- Updates the generated app's `package.json` name from the target folder.
- Prints the next setup commands.

The target directory must be empty, except for common metadata files such as
`.git`, `.gitkeep`, `.DS_Store`, and `Thumbs.db`.

## Development

```bash
npm install
npm test
```

Run the CLI locally:

```bash
node ./bin/create-vergekit.js my-app
```

Check the npm package contents before publishing:

```bash
npm pack --dry-run
```
