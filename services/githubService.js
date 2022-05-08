const axios = require("axios");
const config = require("../config.js");
const moment = require('moment')

class githubService {
    static async getLastCommit() {
        const response = await axios.get(config.github.pactAgentUrl)
        const time = response.data[0].created_at
        const ago = moment(time).fromNow()
        const lastCommit = {number: ago.split(' ')[0], rest: ago.split(' ')[1] + ' ' + ago.split(' ')[2]}
        if ((lastCommit.number.toLowerCase() === 'few')) lastCommit.number = 0
        return lastCommit
    }
}

module.exports = githubService

