/*
 * Copyright (c) 2018 Home Box Office, Inc. as an unpublished
 * work. Neither this material nor any portion hereof may be copied or
 * distributed without the express written consent of Home Box Office, Inc.
 *
 * This material also contains proprietary and confidential information
 * of Home Box Office, Inc. and its suppliers, and may not be used by or
 * disclosed to any person, in whole or in part, without the prior written
 * consent of Home Box Office, Inc.
 */

"use strict";

var compressing = require("compressing");
var execa       = require("execa");
var fs          = require("fs-extra");
var grunt       = require("grunt");
var path        = require("path");
var git         = require("simple-git/promise");
var when        = require("when");
var which       = require("which");
var xml2js      = require("xml2js");

var Promise     = require("bluebird");

var readdir     = Promise.promisify(require("recursive-readdir"));
var remDir      = Promise.promisify(fs.remove);
var parseXml    = Promise.promisify(xml2js.parseString);
var zipFolder   = Promise.promisify(require("zip-a-folder").zipFolder);

var internals = {
    initConfig: function () {
        if (internals.config !== undefined) {
            return;
        }
        grunt.config.requires(
            "gitsketch.unpacked",
            "gitsketch.export.to",
            "gitsketch.export.tool",
            "gitsketch.export.type",
            "gitsketch.export.args.formats",
            "gitsketch.fonts.embedPrefixes",
            "gitsketch.fonts.ignorePrefixes"
        );

        internals.config = grunt.config("gitsketch");
        grunt.verbose.writeln("Configuration loaded successfully.");
        grunt.log.debug(JSON.stringify(internals.config, null, 2));
    },
    getBaseName: function (fullPath) {
        return path.basename(fullPath, path.extname(fullPath));
    },
    stagePath: function (targetPath, stageUntracked) {
        var args = ["add"];
        if (stageUntracked === true) {
            args.push("-u");
        }
        args.push(targetPath);
        grunt.log.debug("stagePath git.raw() args: " + args.join(", "));
        grunt.verbose.write("Staging " + targetPath + "...");
        return git().raw(args).then(function () {
            grunt.verbose.ok();
        });
    },
    deleteDirAndStage: function (targetDirPath) {
        if (grunt.file.exists(targetDirPath)) {
            grunt.verbose.write("Deleting " + targetDirPath + "...");
            return remDir(targetDirPath).then(function () {
                grunt.verbose.ok();
                return git().status().then(function (status) {
                    grunt.log.debug("git().status(): " + JSON.stringify(status, null, 2));
                    if (status.files.some(function (fileStatus) {
                        var filePath = path.resolve(fileStatus.path);
                        // If anything's been changed under targetDirPath
                        var changed = filePath.startsWith(targetDirPath) && fileStatus.working_dir !== " ";

                        if (changed === true) {
                            grunt.log.debug("Deleted folder changes found for: " + filePath + " (" + fileStatus.working_dir + ")");
                        } 
                    }) === true) {
                        grunt.verbose.writeln("Deleted folder changes found");
                        return internals.stagePath(targetDirPath, true /*stageUntracked*/);
                    }
                });
            });
        }

        grunt.verbose.writeln("Nothing to delete at " + targetDirPath);
        return when();
    },
    findSketchTool: function () {
        var sketchToolPath = internals.config.export.tool;
        grunt.verbose.writeln("Searching for sketchtool under " + sketchToolPath + "...");
        if (grunt.file.exists(sketchToolPath) !== true) {
            grunt.verbose.writeln(" Not found.".yellow);
            grunt.verbose.write(". Searching under PATH... ");

            try {
                sketchToolPath = which.sync("sketchtool");
                grunt.verbose.ok();
            } catch (__error) {
                grunt.fail.fatal("Could not locate sketchtool under '" + sketchToolPath + "'. Please install Sketch or add sketchtool to your PATH.");
            }
        }

        grunt.log.debug("Sketch tool located under: " + sketchToolPath);
        return sketchToolPath;
    },
    embedFontInSvg: function (fontName, svgXmlObject) {
        var fontFileExtension = internals.config.fonts.extension;
        var fontsDirPath = path.resolve(internals.config.fonts.path);
        var fontFilePath = path.join(fontsDirPath, fontName + "." + fontFileExtension);
        grunt.log.debug("fontFileExtension: " + fontFileExtension);
        grunt.log.debug("fontsDirPath: " + fontsDirPath);
        grunt.log.debug("fontFilePath: " + fontFilePath);
        grunt.verbose.writeln("Embedding " + fontFilePath);
        if (svgXmlObject.svg.defs === undefined) {
            grunt.log.debug("svgXmlObject.svg.defs undefined");
            svgXmlObject.svg.defs = [];
        }

        var defs = svgXmlObject.svg.defs;
        var def = defs.find(function (d) {
            return typeof d !== "string";
        });

        if (def === undefined) {
            grunt.verbose.writeln("Adding defs entry");
            def = {};
            defs.push(def);
        }

        if (def.style === undefined) {
            grunt.verbose.writeln("Adding style entry");
            def.style = [];
        }

        grunt.verbose.write("Reading font file contents...");
        var fontFileContents = fs.readFileSync(fontFilePath);
        grunt.verbose.ok();
        grunt.verbose.write("Encoding font file contents...");
        var base64Contents = new Buffer(fontFileContents).toString("base64");
        grunt.verbose.ok();

        def.style.push({
            $: {
                type: "text/css",
            },
            embeddedFont: [
                {
                    $: {
                        "font-family":  fontName,
                        "font-type":    fontFileExtension,
                        "font-base64":  base64Contents,
                    },
                },
            ],
        });
    },
    processSvg: function (svgFilePath) {
        grunt.verbose.subhead("Post-processing " + svgFilePath);
        grunt.log.debug("svgFilePath: " + svgFilePath);
        var fontsToEmbed = {};
        var svgFileContents = grunt.file.read(svgFilePath);
        return parseXml(svgFileContents, {
            attrValueProcessors: [function (value, name) {
                if (name === "font-family") {
                    grunt.verbose.writeln("Processing font-family value: " + value);
                    var fontFamilies = value.split(", ").map(function (fontFamily) {
                        var fontPrefixMatch = function (prefix) {
                            return fontFamily.startsWith(prefix) === true;
                        };
                        var shouldEmbed = internals.config.fonts.embedPrefixes.some(fontPrefixMatch);
                        var shouldSkip = internals.config.fonts.ignorePrefixes.some(fontPrefixMatch);
                        grunt.log.debug("shouldEmbed (" + fontFamily + "): " + shouldEmbed);
                        grunt.log.debug("shouldSkip (" + fontFamily + "): " + shouldSkip);

                        // No need to embed the same font more than once
                        if (fontsToEmbed[fontFamily] === undefined && shouldEmbed === true) {
                            if (shouldSkip === true) {
                                grunt.verbose.warn("Skipping " + fontFamily);
                            } else {
                                grunt.verbose.writeln(("Font family to embed: " + fontFamily).cyan);
                                fontsToEmbed[fontFamily] = true;
                            }
                        }

                        if (fontFamily.indexOf(" ") > -1 && fontFamily[0] !== "'") {
                            grunt.verbose.write(("Found an invalid font-family value: \"" + fontFamily + "\". Fixing...").cyan);
                            fontFamily = "'" + fontFamily + "'";
                            grunt.verbose.ok();
                        }

                        return fontFamily;
                    });

                    value = fontFamilies.join(", ");
                    grunt.log.debug("Final font-family value: " + value);
                }

                return value;
            }],
        }).then(function (svgObject) {
            fontsToEmbed = Object.keys(fontsToEmbed);
            if (fontsToEmbed.length > 0) {
                grunt.verbose.subhead("Embed fonts in exported SVGs");
                grunt.verbose.writeln("Fonts to embed: " + fontsToEmbed.join(", "));

                fontsToEmbed.forEach(function (fontName) {
                    internals.embedFontInSvg(fontName, svgObject);
                });

                var builder = new xml2js.Builder();
                var svgContentsBuffer = builder.buildObject(svgObject);
                fs.writeFileSync(svgFilePath, svgContentsBuffer);
                var svgContents = grunt.file.read(svgFilePath);
                svgContents = svgContents.replace(/<embeddedFont font-family="(.+)" font-type="(.+)" font-base64="(.+)"\/>/g,
                    "<![CDATA[\n        " +
                    "@font-face { font-family: \"$1\"; src: url(\"data:application/x-font-$2;base64,$3=\"); }\n      " +
                    "]]>");
                fs.writeFileSync(svgFilePath, svgContents);
            } else {
                grunt.log.debug("No fonts need to be embedded");
            }
        });
    },
    exportContent: function (sketchFilePath, targetDirPath) {
        grunt.verbose.subhead("Sketchtool export");
        grunt.log.debug("exportContent: " + sketchFilePath + ", " + targetDirPath);
        return internals.deleteDirAndStage(targetDirPath).then(function () {
            grunt.log.debug("deleteDirAndStage done");
            var sketchTool = internals.findSketchTool();
            var exportOptions = internals.config.export;
            var command = sketchTool + " export " + exportOptions.type + " " + sketchFilePath;
            var exportArgs = exportOptions.args;

            var argsString = " --output=" + targetDirPath;
            Object.keys(exportArgs).forEach(function (argKey) {
                if (argKey === "output") {
                    grunt.log.warn("Ignoring configuration `gitsketch.export.args.output` – using `gitsketch.export.to`, instead");
                    return;
                }

                argsString += " --" + argKey + "=" + exportArgs[argKey];
            });

            command += argsString;

            grunt.log.debug("Executing: " + command);
            return execa.shell(command).then(function (result) {
                grunt.log.debug("Sketchtool result: " + JSON.stringify(result, null, 2));
                // Exported successfully
                if (result.code === 0) {
                    var exported = [];
                    var regex = /Exported (.*)\n*/g;
                    var match = regex.exec(result.stdout);
                    while (match) {
                        exported.push(path.join(targetDirPath, match[1]));
                        match = regex.exec(result.stdout);
                    }

                    grunt.log.debug("exported: " + exported.join(", "));
                    var processSvgsIfNecessary = when.reduce(exported, function (p, exportedPath) {
                        var extension = path.extname(exportedPath);
                        grunt.log.debug("extension: " + extension);
                        if (extension === ".svg") {
                            return internals.processSvg(exportedPath).then(function () {
                                grunt.log.debug("processSvg done (" + exportedPath + ")");
                            });
                        }
                    }, when() /* initial promise */);

                    return processSvgsIfNecessary.then(function () {
                        grunt.log.debug("processSvgsIfNecessary done");
                        return internals.stagePath(targetDirPath).then(function () {
                            grunt.log.debug("stagePath done");
                            return exported;
                        });
                    });
                }
            });
        });
    },
    processUnpackedFiles: function (unpackedDirPath) {
        return readdir(unpackedDirPath).then(function (files) {
            grunt.log.debug("readdir done: " + files.join(", "));
            return Promise.all(files.map(function (filePath) {
                if (path.extname(filePath).toLowerCase() === ".json") {
                    grunt.verbose.writeln("Prettifying " + filePath);
                    return fs.readJson(filePath).then(function (documentJson) {
                        var baseName = internals.getBaseName(filePath);
                        grunt.log.debug("readJson done (" + baseName + ")");
                        if (baseName === "document") {
                            grunt.verbose.writeln("Setting document.json currentPageIndex to 1");
                            documentJson.currentPageIndex = 1;
                        }
                        return fs.writeJson(filePath, documentJson, { spaces: "\t" }).then(function () {
                            grunt.log.debug("writeJson done (" + baseName + ")");
                        });
                    });
                }
            })).then(function () {
                return internals.stagePath(unpackedDirPath);
            });
        });
    },
    unpackSketchFile: function (sketchFilePath, unpackedDirPath) {
        return internals.deleteDirAndStage(unpackedDirPath).then(function () {
            grunt.log.debug("deleteDirAndStage done");
            grunt.log.write("Unpacking sketch file...")
            return compressing.zip.uncompress(sketchFilePath, unpackedDirPath).then(function () {
                grunt.log.ok();
                grunt.log.debug("uncompress done");
                var previewsDirPath = path.join(unpackedDirPath, "previews");
                    grunt.log.debug("previewsDirPath: " + previewsDirPath);
                if (grunt.file.exists(previewsDirPath) && internals.config.deletePreviews === true) {
                    grunt.verbose.writeln("Deleting " + previewsDirPath);
                    return remDir(previewsDirPath);
                }
            });
        });
    },
    updateReadmeFile: function (parentDirPath, imagesDirPath, exported) {
        grunt.log.debug("updateReadmeFile: " + parentDirPath + ", " + imagesDirPath + ", {exported}");
        var readmeFilePath = path.join(parentDirPath, "README.md");
        grunt.log.debug("readmeFilePath: " + readmeFilePath);
        // Assumes the Gruntfile.js is at the root of the repo
        var repoRootDirPath = path.resolve(".");
        grunt.log.debug("repoRootDirPath: " + repoRootDirPath);
        var relativeContentPaths = exported.map(function (imagePath) {
            return imagePath.substring(repoRootDirPath.length);
        });
        grunt.log.debug("relativeContentPaths:\n" + relativeContentPaths.join("\n"));

        const imagesStartTag = "<br class=\"start-images\" />";
        const imagesEndTag = "<br class=\"end-images\" />";
        var contentReferencesString = imagesStartTag + "\n";
        relativeContentPaths.forEach(function (exported) {
            var baseName = internals.getBaseName(exported);
            var contentReference = "### " + baseName + "\n\n![content](" + exported.replace(" ", "%20") + ")";
            grunt.log.debug("contentReference: " + contentReference);
            contentReferencesString += "\n" + contentReference + "\n";
        });

        contentReferencesString += "\n" + imagesEndTag;

        var readmeFileContents;
        if (grunt.file.exists(readmeFilePath)) {
            grunt.verbose.writeln("Found existing README.md file");
            readmeFileContents = grunt.file.read(readmeFilePath);
        } else {
            grunt.verbose.writeln("Creating a new README.md file");
            readmeFileContents = imagesStartTag + imagesEndTag;
        }

        var startTagIndex = readmeFileContents.indexOf(imagesStartTag);
        var endTagIndex = readmeFileContents.indexOf(imagesEndTag);
        grunt.log.debug("startTagIndex: " + startTagIndex);
        grunt.log.debug("endTagIndex: " + endTagIndex);

        var appendAtEndOfFile = true;
        if (startTagIndex !== endTagIndex) {
            var missing;
            if (startTagIndex === -1) {
                missing = imagesStartTag;
            } else if (endTagIndex === -1) {
                missing = imagesEndTag;
            }

            if (missing !== undefined) {
                grunt.fail.warn("Couldn't find '" + missing + "' in " + readmeFilePath);

                // --force used, act as if neitehr of the tags were found
                grunt.log.warn("--force used, appending image references to the end of the readme file.");
            } else if (startTagIndex > endTagIndex) {
                grunt.fail.warn("Found '" + imagesStartTag + "' after '" + imagesEndTag + "' in " + readmeFilePath + ". Is everything alright?");

                // --force used, act as if neither of the tags were found
                grunt.log.warn("--force used, appending image references to the end of the readme file.");
            } else {
                appendAtEndOfFile = false;
            }
        }

        grunt.log.writeln("Updating content references");

        if (appendAtEndOfFile === true) {
            grunt.verbose.writeln("Appending references at the end of the readmme file");
            readmeFileContents += contentReferencesString;
        } else {
            readmeFileContents = readmeFileContents.substring(0, startTagIndex) +
                                 contentReferencesString +
                                 readmeFileContents.substring(endTagIndex + imagesEndTag.length);
        }

        grunt.file.write(readmeFilePath, readmeFileContents);
        return internals.stagePath(readmeFilePath);
    },
};

var sketch = {
    import: function (sketchFilePath, parentDirPath) {
        grunt.log.subhead("Importing " + sketchFilePath);
        grunt.log.debug("import: " + sketchFilePath + ", " + parentDirPath);
        internals.initConfig();
        if (!grunt.file.exists(sketchFilePath)) {
            grunt.fail.fatal("Source sketch file not found: " + sketchFilePath);
        }

        var srcBaseName = path.basename(sketchFilePath, path.extname(sketchFilePath));
        grunt.log.debug("srcBaseName: " + srcBaseName);
        var srcFileName = path.basename(sketchFilePath);
        grunt.log.debug("srcFileName: " + srcFileName);
        parentDirPath = path.join(path.resolve(parentDirPath), srcBaseName);
        grunt.log.debug("parentDirPath: " + parentDirPath);

        if (grunt.file.exists(parentDirPath)) {
            grunt.fail.warn("Target sketch dir already exists: " + parentDirPath);
        }

        grunt.verbose.write("Creating sketch dir: " + parentDirPath + "...");
        grunt.file.mkdir(parentDirPath);
        grunt.verbose.ok();
        var importedSketchFilePath = path.join(parentDirPath, srcFileName);
        grunt.log.debug("importedSketchFilePath: " + importedSketchFilePath);

        grunt.file.copy(sketchFilePath, importedSketchFilePath);

        return sketch.stage(importedSketchFilePath);
    },
    stage: function (sketchFilePath) {
        grunt.log.subhead("Staging " + sketchFilePath);
        internals.initConfig();
        sketchFilePath = path.resolve(sketchFilePath);
        grunt.log.debug("sketchFilePath: " + sketchFilePath);
        if (!grunt.file.exists(sketchFilePath)) {
            grunt.fail.fatal("Sketch file not found: " + sketchFilePath);
        }

        var fileBaseName = internals.getBaseName(sketchFilePath);
        var parentDirPath = path.dirname(sketchFilePath);
        var parentDirName = path.basename(parentDirPath);
        grunt.log.debug("fileBaseName: " + fileBaseName);
        grunt.log.debug("parentDirPath: " + parentDirPath);
        grunt.log.debug("parentDirName: " + parentDirName);

        if (fileBaseName !== parentDirName) {
            grunt.fail.warn("Sketch file name '" + fileBaseName + "' is different than its parent dir name '" +
                            parentDirName + "'.\n" +
                            "If you're trying to add a new sketch file to git, use the following command:\n" +
                            "grunt importSketch --src=<sketch-file> --target=<parent-dir>.");
        }

        var exportedDirPath = path.join(parentDirPath, internals.config.export.to);
        var unpackedDirPath = path.join(parentDirPath, internals.config.unpacked);
        grunt.log.debug("exportedDirPath: " + exportedDirPath);
        grunt.log.debug("unpackedDirPath: " + unpackedDirPath);
        return internals.unpackSketchFile(sketchFilePath, unpackedDirPath).then(function () {
            grunt.log.debug("unpackSketchFile done");
            return internals.processUnpackedFiles(unpackedDirPath).then(function () {
                grunt.log.debug("processUnpackedFiles done");
                return internals.exportContent(sketchFilePath, exportedDirPath).then(function (exported) {
                    grunt.log.debug("exportContent done");
                    if (internals.config.generateReadme === true) {
                        return internals.updateReadmeFile(parentDirPath, exportedDirPath, exported).then(function () {
                            grunt.log.debug("updateReadmeFile done");
                        });
                    } else {
                        grunt.verbose.writeln("Skipping README.md (generateReadme is " + internals.config.generateReadme + ")");
                    }
                });
            });
        });
    },
    generate: function (parentDirPath) {
        grunt.log.subhead("Generating sketch file for " + parentDirPath);
        internals.initConfig();
        parentDirPath = path.resolve(parentDirPath);
        grunt.log.debug("parentDirPath: " + parentDirPath);
        if (!grunt.file.exists(parentDirPath)) {
            grunt.fail.fatal("Source sketch folder not found: " + parentDirPath);
        }

        var unpackedDirPath = path.resolve(path.join(parentDirPath, internals.config.unpacked));
        grunt.log.debug("unpackedDirPath: " + unpackedDirPath);
        if (!grunt.file.exists(unpackedDirPath)) {
            grunt.fail.fatal("Unable to generate sketch file – could not find: " + unpackedDirPath);
        }

        var parentDirName = internals.getBaseName(parentDirPath);
        var sketchFilePath = path.join(parentDirPath, parentDirName + ".sketch");
        grunt.log.debug("parentDirName: " + parentDirName);
        grunt.log.debug("sketchFilePath: " + sketchFilePath);

        grunt.verbose.write("Generating " + sketchFilePath + " from " + unpackedDirPath);
        return zipFolder(unpackedDirPath, sketchFilePath).then(function () {
            grunt.verbose.ok();
            return sketchFilePath;
        });
    },        
};

module.exports = sketch;
