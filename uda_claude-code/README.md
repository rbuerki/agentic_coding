### Setup instructions

install nvm + Node LTS natively

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm alias default 'lts/*'
node -v
npm -v
which node
which npm
```

then in the repo root run

```bash
# Install everything
npm install

# Or install only one demo/exercise
npm install --workspace lesson-10-multi-agent-orchestration/demo
```

Run a specific demo/exercise from the repo root:

```bash
npm run --workspace lesson-10-multi-agent-orchestration/demo start
```

You can also `cd` into a demo/exercise folder and run `npm start` after the root install.
