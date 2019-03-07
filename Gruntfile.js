/*
 * Copyright (c) 2013 Home Box Office, Inc. as an unpublished
 * work. Neither this material nor any portion hereof may be copied or
 * distributed without the express written consent of Home Box Office, Inc.
 *
 * This material also contains proprietary and confidential information
 * of Home Box Office, Inc. and its suppliers, and may not be used by or
 * disclosed to any person, in whole or in part, without the prior written
 * consent of Home Box Office, Inc.
 */

"use strict";

module.exports = function (grunt) {
    grunt.initConfig({
        gitsketch: {
            deletePreviews:     true,
            export: {
                args: {
                    background: "#FFFFFF",
                    formats:    "svg",
                    trimmed:    "NO",
                },
                to:             "exports",
                tool:           "/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool",
                type:           "artboards",
            },
            fonts: {
                embedPrefixes:  ["Arial"],
                ignorePrefixes: [
                    "Arial ",
                    "ArialNarrow-Italic",
                ],
                path:           "./assets/fonts",
                extension:      "ttf",
            },
            generateReadme:     true,
            unpacked:           ".sketch",
        },
    });

    // Load our custom grunt tasks
    grunt.task.loadTasks("grunt/tasks");
};
