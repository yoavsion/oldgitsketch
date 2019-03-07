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
    grunt.registerTask("importSketch",
        "Imports a sketch file into a git-ready sketch directory", function () {
        var done = this.async();

        var src = grunt.option("src");
        var target = grunt.option("target");
        if (!src || !target) {
            grunt.fail.fatal("Usage: grunt importSketch --src=<sketch-file> --target=<containing dir>");
        }

        sketch.import(src, target).then(function () {
            grunt.log.writeln("Sketch file imported successfully");
            done(true);
        }).catch(function (error) {
            grunt.log.error("Failed importing sketch file:");
            grunt.fail.fatal(error);
        });
    });
};
