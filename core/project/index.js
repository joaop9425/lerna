"use strict";

const cosmiconfig = require("cosmiconfig");
const dedent = require("dedent");
const globParent = require("glob-parent");
const loadJsonFile = require("load-json-file");
const log = require("npmlog");
const path = require("path");
const writeJsonFile = require("write-json-file");

const ValidationError = require("@lerna/validation-error");
const Package = require("@lerna/package");
const applyExtends = require("./lib/apply-extends");

class Project {
  constructor(cwd) {
    const explorer = cosmiconfig("lerna", {
      js: false, // not unless we store version somewhere else...
      rc: "lerna.json",
      rcStrictJson: true,
      sync: true,
      transform(obj) {
        // cosmiconfig returns null when nothing is found
        if (!obj) {
          return {
            // No need to distinguish between missing and empty,
            // saves a lot of noisy guards elsewhere
            config: {},
            // path.resolve(".", ...) starts from process.cwd()
            filepath: path.resolve(cwd || ".", "lerna.json"),
          };
        }

        // normalize command-specific config namespace
        if (obj.config.commands) {
          obj.config.command = obj.config.commands;
          delete obj.config.commands;
        }

        obj.config = applyExtends(obj.config, path.dirname(obj.filepath));

        return obj;
      },
    });

    let loaded;

    try {
      loaded = explorer.load(cwd);
    } catch (err) {
      // redecorate JSON syntax errors, avoid debug dump
      if (err.name === "JSONError") {
        throw new ValidationError(err.name, err.message);
      }

      // re-throw other errors, could be ours or third-party
      throw err;
    }

    this.config = loaded.config;
    this.rootConfigLocation = loaded.filepath;
    this.rootPath = path.dirname(loaded.filepath);

    log.verbose("rootPath", this.rootPath);
  }

  get version() {
    return this.config.version;
  }

  set version(val) {
    this.config.version = val;
  }

  get packageConfigs() {
    if (this.config.useWorkspaces) {
      const workspaces = this.manifest.json.workspaces;

      if (!workspaces) {
        throw new ValidationError(
          "EWORKSPACES",
          dedent`
            Yarn workspaces need to be defined in the root package.json.
            See: https://github.com/lerna/lerna#--use-workspaces
          `
        );
      }

      return workspaces.packages || workspaces;
    }

    return this.config.packages || [Project.DEFAULT_PACKAGE_GLOB];
  }

  get packageParentDirs() {
    return this.packageConfigs.map(globParent).map(parentDir => path.resolve(this.rootPath, parentDir));
  }

  get manifest() {
    let manifest;

    try {
      const manifestLocation = path.join(this.rootPath, "package.json");
      const packageJson = loadJsonFile.sync(manifestLocation);

      if (!packageJson.name) {
        // npm-lifecycle chokes if this is missing, so default like npm init does
        packageJson.name = path.basename(path.dirname(manifestLocation));
      }

      // Encapsulate raw JSON in Package instance
      manifest = new Package(packageJson, this.rootPath);

      // redefine getter to lazy-loaded value
      Object.defineProperty(this, "manifest", {
        value: manifest,
      });
    } catch (err) {
      // syntax errors are already caught and reported by constructor
      // try again next time
    }

    return manifest;
  }

  isIndependent() {
    return this.version === "independent";
  }

  serializeConfig() {
    // TODO: might be package.json prop
    return writeJsonFile(this.rootConfigLocation, this.config, { indent: 2, detectIndent: true }).then(
      () => this.rootConfigLocation
    );
  }
}

Project.DEFAULT_PACKAGE_GLOB = "packages/*";

module.exports = Project;
