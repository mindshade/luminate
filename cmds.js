'use strict'

/*      section/
 * Import all the functionality we need
 */
const read = require('read')
const StellarSdk = require('stellar-sdk')

/*      section/
 * Use our modules
 */
const luminate = require('./index')


/*      understand/
 * This module handles user requests from the command line by combining
 * the wallet functionality and the stellar functionality to do useful
 * work and respond to the user.
 */
module.exports = {
    create: create,
    activate: activate,
    list: list,
    status: status,
    pay: pay,
    importSecret: importSecret,
    exportSecret: exportSecret,
}

function create(cfg, args, op) {
    let p = loadParams(args)
    let name = p._rest[0]
    if(!name) return err_no_name_1()

    if(p._rest.length > 1) return err_too_many_1()

    op.out(op.chalk`Creating account "{green.bold ${name}}"`)

    withPassword(cfg, (pw) => {
        luminate.wallet.create(pw, cfg.wallet_dir, name, (err, acc) => {
                if(err) op.err(err)
                else op.out(op.chalk`{grey ${acc}}`)
        })
    })

    function err_no_name_1() {
        op.err(op.chalk`{red.bold Error:} Please provide a name`)
    }

    function err_too_many_1() {
        let names = p._rest.map(n => `"${n}"`).join(", ")
        op.err(op.chalk`{red.bold Error:} Too many names for account: {green ${names}}`)
    }
}

function activate(cfg, args, op) {
    const errmsg = {
        NODEST: op.chalk`{red.bold Error:} Specify account to activate`,
        NOFROM: op.chalk`{red.bold Error:} Specify wallet account '{green --from}'`,
        NOAMT: op.chalk`{red.bold Error:} Specify '{green --amt}' to fund`,
        BADDEST: (acc) => op.chalk`{red.bold Error:} "${acc}" is not a valid account`,
        BADFROM: (f) => op.chalk`{red.bold Error:} "${f}" is not a valid account`,
    }

    let p = loadParams(args)
    let acc = p._rest[0]
    if(!acc) return op.err(errmsg.NODEST)

    if(p._rest.length > 1) return err_too_many_1()

    if(!p.from) return op.err(errmsg.NOFROM)
    if(!p.amt) return op.err(errmsg.NOAMT)

    op.out(op.chalk`Activating account "{green ${acc}}" from "{red ${p.from}}" with funds "{bold.blue XLM:${p.amt}}"`)

    withAccount(cfg, acc, (err, acc_) => {
        if(err) return op.err(errmsg.BADDEST(acc))
        else {
            luminate.wallet.find(cfg.wallet_dir, p.from, (err, from) => {
                if(err) return op.err(err)
                else if(!from) return op.err(errmsg.BADFROM(p.from))
                else {
                    withPassword(cfg, (pw) => {
                        luminate.wallet.load(pw, cfg.wallet_dir, p.from, (err, from_) => {
                            if(err) return op.err(err)
                            else {
                                luminate.stellar.activate(
                                    cfg.horizon,
                                    from_, p.amt, acc_,
                                    (err) => {
                                        if(err) return op.err(err)
                                        else op.out(op.chalk`{bold Activated}`)
                                    })
                            }
                        })
                    })
                }
            })
        }
    })

    function err_too_many_1() {
        let names = p._rest.map(n => `"${n}"`).join(", ")
        op.err(op.chalk`{red.bold Error:} Too many names for account: {green ${names}}`)
    }
}

function list(cfg, args, op) {
    luminate.wallet.list(cfg.wallet_dir, (err, accs, errs) => {
        if(err) op.err(err)
        else {
            for(let i = 0;i < accs.length;i++) {
                let name = accs[i].name
                let pub = accs[i].pub
                op.out(op.chalk`{bold ${name}} {gray ${pub}}`)
            }
            if(errs && errs.length && !cfg.asScript) {
                op.err(op.chalk`\n{red.bold Did not understand files:}`)
                for(let i = 0;i < errs.length;i++) {
                    op.err(op.chalk`  {underline ${errs[i]}}`)
                }
            }
        }
    })
}

function status(cfg, args, op) {
    if(args.length == 1) {
        luminate.wallet.find(cfg.wallet_dir, args[0], (err, acc) => {
            if(err) op.err(err)
            else if(!acc) op.err(op.chalk`{bold.red Error:} "${args[0]}" is not a valid account`)
            else show_status_1([acc], 0)
        })
    } else {
        luminate.wallet.list(cfg.wallet_dir, (err, accs) => {
            if(err) op.err(err)
            else show_status_1(accs, 0)
        })
    }

    function show_status_1(accs, ndx) {
        if(ndx >= accs.length) return
        let acc = accs[ndx]

        luminate.stellar.status(cfg.horizon, acc, (err, ai) => {
            if(err) op.err(err)
            else {
                if(acc.name) op.out(op.chalk`{bold Account:} {green ${acc.name}}`)
                else op.out(op.chalk`{bold Account:} {green ${acc.id}}`)
                op.out(JSON.stringify(public_vals_1(ai),null,2))
            }
            show_status_1(accs, ndx+1)
        })
    }

    /*      outcome/
     * Create a duplicate object that contains only the public values of the
     * given object (ignore functions and `_private` values)
     */
    function public_vals_1(o) {
        let pv = {}
        for(let k in o) {
            if(!o.hasOwnProperty(k)) continue
            if(k.startsWith('_')) continue
            if(typeof o[k] === 'function') continue
            pv[k] = o[k]
        }
        return pv
    }
}


function pay(cfg, args, op) {
    const errmsg = {
        NODEST: op.chalk`{red.bold Error:} Specify payment {green --to}`,
        NOFROM: op.chalk`{red.bold Error:} Specify wallet account name to pay '{green --from}'`,
        NOAMT: op.chalk`{red.bold Error:} Specify '{green --amt}' to pay`,
        BADAMTFMT: op.chalk`{red.bold Error:} Specify amount like this {bold XLM:{red 12.455}}`,
        BADDEST: (to) => op.chalk`{red.bold Error:} "${to}" is not a valid account`,
        BADFROM: (f) => op.chalk`{red.bold Error:} "${f}" is not a valid account`,
    }

    let p = loadParams(args)
    if(!p.to) return op.err(errmsg.NODEST)

    if(p._rest.length > 1) return err_too_many_1()

    if(!p.from) return op.err(errmsg.NOFROM)
    if(!p.amt) return op.err(errmsg.NOAMT)

    let a = p.amt.split(':')
    if(a.length != 2) return op.err(errmsg.BADAMTFMT)
    let asset = a[0]
    let amt = a[1]

    op.out(op.chalk`Paying {bold.blue ${amt} ${asset}} from {red ${p.from}} to {green ${p.to}}`)

    withAccount(cfg, p.to, (err, to) => {
        if(err) return op.err(errmsg.BADDEST(p.to))
        else {
            luminate.wallet.find(cfg.wallet_dir, p.from, (err, from) => {
                if(err) return op.err(err)
                else if(!from) return op.err(errmsg.BADFROM(p.from))
                else {
                    withPassword(cfg, (pw) => {
                        luminate.wallet.load(pw, cfg.wallet_dir, p.from, (err, from_) => {
                            if(err) return op.err(err)
                            else {
                                luminate.stellar.pay(
                                    cfg.horizon,
                                    from_, asset, amt, to,
                                    (err) => {
                                        if(err) return op.err(err)
                                        else op.out(op.chalk`{bold Paid}`)
                                    })
                            }
                        })
                    })
                }
            })
        }
    })

    function err_too_many_1() {
        let dests = p._rest.map(n => `"${n}"`).join(", ")
        op.err(op.chalk`{red.bold Error:} Too many destinations: {green ${dests}}`)
    }
}

function importSecret(cfg, args, op) {
    const errmsg = {
        NONAME: op.chalk`{red.bold Error:} Specify name`,
        NOSECRET: op.chalk`{red.bold Error:} Specify secret`,
        BADSECRET: (s) => op.chalk`{red.bold Error:} "{red ${s}}" is not a valid secret`,
    }

    let name = args[0]
    let secret = args[1]
    if(!name) return op.err(errmsg.NONAME)
    if(!secret) return op.err(errmsg.NOSECRET)
    if(!StellarSdk.StrKey.isValidEd25519SecretSeed(secret)) return op.err(errmsg.BADSECRET(secret))

    withPassword(cfg, (pw) => {
        luminate.wallet.importSecret(pw, cfg.wallet_dir, name, secret, (err) => {
            if(err) op.err(err)
            else op.out(op.chalk`Added new "{bold ${name}}" to wallet`)
        })
    })
}

function exportSecret(cfg, args, op) {
    let name = args[0]
    if(!name) return op.err(op.chalk`{red.bold Error:} Specify account to export`)

    luminate.wallet.find(cfg.wallet_dir, name, (err, acc) => {
        if(err) op.err(err)
        else if(!acc) op.err(op.chalk`{red.bold Error:} "${name}" is not a valid wallet account`)
        else {
            op.out(op.chalk`Exporting "{bold ${acc.name}}" {gray (${acc.pub})} from wallet`)
            withPassword(cfg, (pw) => {
                luminate.wallet.load(pw, cfg.wallet_dir, name, (err, acc_) => {
                    if(err) op.err(err)
                    else {
                        let secret = acc_._kp.secret()
                        op.out(op.chalk`{gray ${secret}}`)
                    }
                })
            })
        }
    })
}


/*      situtation/
 * The user should be able to specify an account by it's name (easier)
 * or by it's id (more reliable, especially when scripting).
 * Additionally there are user inputs that refer to accounts that are
 * NOT managed by our wallet.
 *
 *      problem/
 * Given a user entered string, we need to resolve it to an 'account' -
 * wallet or otherwise.
 *
 *      way/
 * Given a user entered string we look for it as a wallet account. If
 * not found, we check if it is a valid stellar account and, if so,
 * make an 'account' object from it containing only the given public
 * key.
 */
function withAccount(cfg, name, cb) {
    luminate.wallet.find(cfg.wallet_dir, name, (err, acc) => {
        if(err) cb(err)
        else if(!acc) {
            if(!StellarSdk.StrKey.isValidEd25519PublicKey(name)) return cb(`Not a valid account: ${name}`)
            else cb(null, { pub: name })
        } else {
            cb(null, acc)
        }
    })
}

/*      outcome/
 * If the password is set in the environment use that otherwise prompt
 * the user for a password. Provide this to the callback.
 */
function withPassword(cfg, cb) {
    if(cfg.wallet_pw) {
        cb(null, cfg.wallet_pw)
    } else {
        read({
            prompt: "Password:",
            silent: true,
        }, (err,pw) => {
            if(err) cb()
            else cb(pw)
        })
    }
}

/*      outcome/
 * Takes the given parameter array and converts them into an object
 * with corresponding values and the `_rest`.
 */
function loadParams(args) {
    let p = {}
    let rest = []
    if(args && args.length) {
        let val;
        for(let i = 0;i < args.length;i++) {
            let arg = args[i]
            let m = arg.match(/^-+(.*)/)
            if(m) {
                p[m[1]] = true // value is present
                val = m[1] // load next item as value
            } else if(val) {
                p[val] = arg
                val = false;
            } else {
                rest.push(arg)
            }
        }
    }
    p._rest = rest
    return p
}
