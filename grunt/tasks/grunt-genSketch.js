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

var sketch = require("./common/sketch");

module.exports = function (grunt) {
    grunt.registerTask("genSketch",
        "Generates a sketch file from a git-ready sketch directory", function () {
        var done = this.async();

        var parentDirPath = grunt.option("src");
        if (!parentDirPath) {
            grunt.fail.fatal("Usage: grunt genSketch --src=<git-sketch-folder>");
        }

        sketch.generate(parentDirPath).then(function () {
            grunt.log.writeln("Sketch file generated successfully");
            done(true);
        }).catch(function (error) {
            grunt.log.error("Failed generating sketch file:");
            grunt.fail.fatal(error);
        });
    });
};
