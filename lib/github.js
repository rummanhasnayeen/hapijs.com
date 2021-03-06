'use strict';
const debug = require('debug')('github');
const Config = require('getconfig');
const Hoek = require('hoek');
const Utils = require('./utils');
const Semver = require('semver');
const RedisClient = require('./redis');

const internals = {};

internals.requestOptions = {
    headers: {
        'user-agent': 'hapijs.com',
        authorization: `token ${Config.githubToken}`
    },
    json: true
};


exports.methods = [];


exports.methods.push({
    name: 'github.commits',
    method: async function () {

        debug('commits');

        const redisClient = new RedisClient();
        const commits = await redisClient.getCommits();
        await redisClient.destroy();

        return commits;
    }
});


exports.methods.push({
    name: 'github.issues',
    method: async function () {

        const redisClient = new RedisClient();
        const issues = await redisClient.getIssues();
        await redisClient.destroy();

        debug('return issues');
        return  issues.filter((issue) => !issue.pull_request);
    }
});


exports.methods.push({
    name: 'github.pullRequests',
    method: async function () {

        const redisClient = new RedisClient();
        const result = await redisClient.getPullRequests();
        await redisClient.destroy();

        debug('return pull requests');
        return result.filter((p) => p.merged_at);
    }
});

exports.methods.push({
    name: 'github.styleGuide',
    method: function () {

        const options = Hoek.applyToDefaults(internals.requestOptions, {
            headers: { accept: 'application/vnd.github.3.html' }
        });

        return Utils.download('https://api.github.com/repos/hapijs/assets/contents/STYLE.md', options);
    },
    options: {
        cache: {
            expiresIn: Utils.oneDay,
            generateTimeout: Utils.oneMinute
        },
        generateKey: () => 'github.styleGuide'
    }
});

exports.methods.push({
    name: 'github.latestUpdate',
    method: function (request) {

        const latestCommit = request.pre.commits[0];
        const latestIssue = request.pre.issues[0];
        const latest = {};

        if (latestCommit && !latestIssue || (latestCommit && latestIssue && new Date(latestCommit.commit.committer.date).getTime() > new Date(latestIssue.updated_at).getTime())) {
            latest.title = latestCommit.commit.message;
            latest.updated = latestCommit.commit.committer.date;
            latest.url = latestCommit.html_url;
        }
        else if (latestIssue) {
            latest.title = latestIssue.title;
            latest.updated = latestIssue.updated_at;
            latest.url = latestIssue.html_url;
        }

        return latest;
    },
    options: {
        cache: {
            expiresIn: Utils.fifteenMinutes,
            generateTimeout: Utils.oneMinute
        },
        generateKey: () => 'github.latestUpdate'
    }
});

exports.methods.push({
    name: 'github.repos',
    method: () => Utils.download('https://api.github.com/orgs/hapijs/repos', internals.requestOptions),
    options: {
        cache: {
            expiresIn: Utils.oneDay,
            generateTimeout: Utils.oneMinute
        },
        generateKey: () => 'github.repos'
    }
});


exports.methods.push({
    name: 'github.tags',
    method: () => Utils.download('https://api.github.com/repos/hapijs/hapi/tags', internals.requestOptions),
    options: {
        cache: {
            expiresIn: Utils.fifteenMinutes,
            generateTimeout: Utils.oneMinute
        },
        generateKey: () => 'github.tags'
    }
});


exports.methods.push({
    name: 'github.reference',
    method: function (ref) {

        const options = Hoek.applyToDefaults(internals.requestOptions, {
            headers: {
                accept: 'application/vnd.github.3.html'
            }
        });

        let path;
        if (Semver.lt(ref, '8.0.0')) {
            path = 'https://api.github.com/repos/hapijs/hapi/contents/docs/Reference.md?ref=v' + ref;
        }
        else {
            path = 'https://api.github.com/repos/hapijs/hapi/contents/API.md?ref=v' + ref;
        }

        return Utils.download(path, options);
    },
    options: {
        cache: {
            expiresIn: Utils.oneYear,
            generateTimeout: Utils.oneMinute
        },
        generateKey: (tag) => `github.reference.${tag}`
    }
});


exports.methods.push({
    name: 'github.apiModules',
    method: async function (request) {

        const options = Hoek.applyToDefaults(internals.requestOptions, {
            headers: {
                accept: 'application/vnd.github.3.html'
            }
        });

        const repoNames = request.pre.repos.filter((repo) => !repo.archived).map((repo) => repo.name);
        const apiDocPromises =
            repoNames.map((name) => Utils.download(`https://api.github.com/repos/hapijs/${name}/contents/API.md`, options));
        const apiDocsResults = await Promise.all(apiDocPromises);
        const moduleWithApis = apiDocsResults.reduce((acc, doc, index) => {

            return doc && repoNames[index] !== 'hapi' ? [...acc, { name: repoNames[index], html: doc }] : acc;
        }, []);

        moduleWithApis.sort((a, b) => {

            if (a.name < b.name) {
                return -1;
            }
            else if (a.name > b.name) {
                return 1;
            }

            return 0;
        });

        return moduleWithApis;
    }
});
