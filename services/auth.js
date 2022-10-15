const fs = require('fs')
const passport = require('passport')
const GoogleStrategy = require('passport-google-oauth2').Strategy;

let googleConfFile = '{"web": {"client_id":"123","client_secret":"123"}}'
try {
    googleConfFile = fs.readFileSync('./data/client_secret.json', 'utf8')
} catch (e) {
    console.log('No Google conf found')
}
const googleConf = JSON.parse(googleConfFile)

let singleUserFile = '{"singleUser":""}'
try {
    singleUserFile = fs.readFileSync('./data/single_user.json', 'utf8')
} catch (e) {
    console.log('No single user conf found')
}
const singleUser = JSON.parse(singleUserFile)


const tree = __dirname.split('/')
const instance = tree[tree.length - 2]
console.log(instance)

let portConfFile = '[]'
try {
    portConfFile = fs.readFileSync('../portConf.json', 'utf8') //Dir level
} catch (e) {
    console.log('No port conf found')
}
const portConf = JSON.parse(portConfFile)
const confPort = portConf.find(e => e.instance === instance)

let topDom = 'io'
if (confPort && (
    (confPort.port >= 19062) ||
    (confPort.port >= 19034 && confPort.port <= 19043) ||
    (confPort.port >= 19058 && confPort.port <= 19059)
    )) topDom = 'co'

console.log(confPort.port, topDom)

const  GOOGLE_CLIENT_ID = googleConf.web.client_id
const  GOOGLE_CLIENT_SECRET = googleConf.web.client_secret

passport.use(new GoogleStrategy({
        clientID:     GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `https://${instance}.crankk.${topDom}/auth/googleCallback`,
        passReqToCallback   : true
    },
    function(request, accessToken, refreshToken, profile, done) {
        if (!Array.isArray(singleUser) && singleUser.singleUser.length === 0) {
            singleUser.singleUser = profile.email
            fs.writeFileSync('./data/single_user.json', JSON.stringify(singleUser))
            return done(null, profile) //success
        } else {
            if (Array.isArray(singleUser)) {
                const user = singleUser.find(e => e.singleUser === profile.email)
                if (user) {
                    return done(null, profile) //success
                } else {
                    return done(null, null)
                }
            } else {
                if (singleUser.singleUser === profile.email) {
                    return done(null, profile) //success
                } else {
                    return done(null, null)
                }
            }
        }
    }
));

passport.serializeUser((user, done) => {
    done(null, user)
})

passport.deserializeUser((user, done) => {
    done(null, user)
})