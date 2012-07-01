/*
 * Copyright (c) 2012 Adam Jabłooński
 *
 * Gmail Notify Extension is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gmail Notify Extension is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Authors: Adam Jabłoński <jablona123@gmail.com>
 *          Vadim Rutkovsky <roignac@gmail.com>
 *
 */
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const TlsConn = Extension.imports.tlsconnection;
const Imap = Extension.imports.imap;
const OAuth = Extension.imports.oauth;
const Logger = Extension.imports.logger;

const Signals = imports.signals;
const Lang = imports.lang;
const Soup = imports.gi.Soup;
const Goa = imports.gi.Goa;
const sess = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(sess,
                                        new Soup.ProxyResolverDefault());


var GmailConnection = function () {
    this._init.apply(this,arguments);
}

GmailConnection.prototype = {
    __proto__: TlsConn.TlsConnection.prototype,

    _init : function (account) {
        Logger.log("GmailConnection._init")
        if (account.get_account().provider_name.toUpperCase() != "GOOGLE"){
            throw new Error('This is not Google Account')
        }
        this._oAccount = account;
        Logger.log("Creating gmail conn to " + this._oAccount.get_account().id);
        this._oMail = this._oAccount.get_mail();
        TlsConn.TlsConnection.prototype._init.call(this,
                                                   this._oMail.imap_host,
                                                   this._oMail.imap_use_tls ? 993 : 143)
    }

};

//dummy class to emulate imap;
function GmailHttps() {
    this._init.apply(this,arguments);

};

GmailHttps.prototype = {
    _init : function (account) {
        this.connected = true;
        this._oAccount = account;
    },
    _disconnect : function () {
        this.connected = false;
        this.emit('disconnected');
    }
};

Signals.addSignalMethods(GmailHttps.prototype);

function GmailImap () {
    this._init.apply(this,arguments);
};

GmailImap.prototype= {
    __proto__:Imap.Imap.prototype,
    
    _init : function (conn) {
        Logger.log("GmailImap._init")
        try {
            if (conn instanceof GmailConnection) {
                Imap.Imap.prototype._init.call(this,conn) ;
            } else  {
                let oconn = new GmailConnection(conn);
                Imap.Imap.prototype._init.call(this,oconn) ;
                Logger.log("Imap created: "+this._conn._oAccount.get_account().id);
            }
            this.authenticated=false;
            this._conn.connect('disconnected',
                               Lang.bind(this,function(){
                                    this.authenticated = false;
                                }))
        } catch (err) {
            Logger.log("gmailImap.proto:"+err.message);
        }
    },
    
    readGreeting : function (callback) {
        Logger.log("GmailImap.readGreeting")
        this._readBuffer("", true, true,
                Lang.bind(this,function (oImap,resp) {
                if (resp[0].substr(2,2) == "OK") {
                    this.gmailConnected = true;
                    this.emit('greeting-ready');
                    if (typeof(callback) != 'undefined') {
                            callback.apply(this,[this,resp]);
                    }
                }
        } ));
    },

    authenticate: function(account,service,callback) {
        Logger.log("GmailImap.authenticate")
        try {
            if (this._conn.connected) {
                this._doauthenticate(account,service,callback)
            } else {
                var _acc=account;
                var _svr=service;
                var _call=callback;
                this._conn._connect(Lang.bind(this,function () {
                    this._doauthenticate(_acc,_svr,_call)
                }));
            }
        } catch (err) {
            Logger.log("authenticate: "+err.message)
        }
    },
    
    _doauthenticate : function (account, service, callback) {
        Logger.log("GmailImap._doauthenicate")
        try {
            let oAuth = new OAuth.OAuth(account,service);
            let auth_str = oAuth.oAuth_str;
            this._command("AUTHENTICATE XOAUTH " + auth_str,
                            false,
                            Lang.bind(this, function (oGIMap,resp) {
                                for (let response in resp)
                                    Logger.log("response: " + resp[response]);
                                if (this._commandOK(resp)){
                                    this.authenticated = true;
                                    this._conn.newline = String.fromCharCode(13)+String.fromCharCode(10);
                                    if (typeof(callback) != 'undefined') {
                                        callback.apply(this,
                                                      [this,resp]);
                                    }
                                    this.emit('authenticated',true);
                                } else {
                                    if (typeof(callback) != 'undefined') {
                                        callback.apply(this, [this, resp,
                                                       new Error('Authentication error')]);
                                    }
                                    this.emit('authenticated',false);
                                }
                            }
                        )
            );
        } catch (err) {
            Logger.log("_doAuthenticate: "+err.message)
        }
    },
    
    scanInbox : function (callback) {
        Logger.log("GmailImap.scanInbox")
        try {
            if (this.authenticated ) {
                this._doScanInbox(callback);
            } else {
                var _call=callback;

                    this.authenticate(this._conn._oAccount,
                                     "https://mail.google.com/mail/b/"+this._conn._oMail.imap_user_name+"/imap/",
                                     Lang.bind(this,function(){
                                        this._doScanInbox(_call);
                                     }))
            }
        } catch (err) {
            Logger.log("scanInbox: "+err.message)
        }

    },

    _doScanInbox: function (callback,i) {
        Logger.log("doScan entry")
        try {
            this._scanFolder("INBOX",
                             Lang.bind(this,function(oImap,resp,error){
                                Logger.log("doScan callback, i=" + i);
                                try {
                                    if (typeof(callback) != 'undefined') {
                                        if (typeof(error) == 'undefined') {
                                            callback.apply(this,[this,resp]);
                                        } else {
                                            callback.apply(this,[this,resp,error]);
                                        }
                                    }
                                    Logger.log("doScan"+this.folders.length);

                                    this.emit('inbox-scanned',resp,error)
                                } catch (err) {
                                    Logger.log("doScan :"+err.message)
                                }
                            }));
        }
        catch (err) {
            Logger.log("_doscanInbox: "+err.message)
        }
    }
};

Signals.addSignalMethods(GmailImap.prototype);
