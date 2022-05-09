const axios = require("axios");
const config = require("../config.js");
const moment = require('moment')

class githubService {
    static async getLastCommit() {
        const response = await axios.get(config.github.pactAgentUrl)
        const time = response.data[0].created_at
        const ago = moment(time).fromNow()
        const lastCommit = {number: ago.split(' ')[0], rest: ago.split(' ')[1] + ' ' + ago.split(' ')[2]}
        if (!this.isNumeric(lastCommit.number)) lastCommit.number = '1'
        return lastCommit
    }
    static isNumeric(str) {
        if (typeof str != "string") return false // we only process strings!
        return !isNaN(str) && // use type coercion to parse the _entirety_ of the string (`parseFloat` alone does not do this)...
            !isNaN(parseFloat(str)) // ...and ensure strings of whitespace fail
    }
}

module.exports = githubService

