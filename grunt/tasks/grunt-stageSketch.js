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
    grunt.registerTask("stageSketch",
        "Stages changes made to a sketch file inside a git-ready sketch directory", function () {
        var done = this.async();

        var src = grunt.option("src");
        if (!src) {
            grunt.fail.fatal("Usage: grunt stageSketch --src=<sketch-file>");
        }

        sketch.stage(src).then(function () {
            grunt.log.writeln("Sketch file staged successfully");
            done(true);
        }).catch(function (error) {
            grunt.log.error("Failed staging sketch file failed:");
            grunt.fail.fatal(error);
        });
    });
};
