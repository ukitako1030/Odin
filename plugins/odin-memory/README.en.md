# Odin Memory distribution template

This template provides the saving rules and display metadata for a plugin that searches your own Odin and stores knowledge, tasks, and ideas from conversations. It contains no author's URL, connection ID, or credentials.

Installing this folder as-is will not configure a connection. From the Odin repository root, generate a plugin with your own connection settings:

```sh
npm ci
npm run setup:plugin -- --language en
```

[Connection, generation, and installation guide](../../docs/PLUGIN-SETUP.en.md)

This template is available under the [MIT License](../../LICENSE). Dependencies and third-party rights have their own terms. See [release status](../../docs/RELEASE-STATUS.en.md).
