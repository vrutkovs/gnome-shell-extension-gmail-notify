/*
 * Copyright (c) 2012 Adam Jabłoński
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
 */

//TODO Add listener for Goa account changes
//TODO Use only account which have email check enabled
//TODO Show 'checking' on startup instead of 'no messages'
//TODO Add safemode capability

// Imports section
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Gettext = imports.gettext.domain('gmail_notify');
const _ = Gettext.gettext;
const GConf = imports.gi.GConf;
const Utils = imports.misc.util;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Clutter = imports.gi.Clutter;
const Soup =  imports.gi.Soup;
const Goa = imports.gi.Goa;

// Load other classes required by this extension
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Logger = Extension.imports.logger;
const Gmail = Extension.imports.gmail;
const Imap = Extension.imports.imap;


// Constants
const CHECK_TIMEOUT = 300;
const GCONF_ACC_KEY="/apps/gmail_notify/accounts";
const GCONF_DIR = "/apps/gmail_notify";
const _version = "0.4";

// Initialize soup and enable proxy resolver
const sSes=new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(sSes,
                                        new Soup.ProxyResolverDefault());

// GMailButton instance
var button = null;
// Timed event for mailbox check
var periodicInboxCheckEvent = null;
// Extension path
var extensionPath = null;
// Configuration instance
var config = null;
// Text format
// TODO Remove this, as safemode = 0 doesn't work currently
var bText = null
// List of goa accounts
var goaAccounts = Array(0);


// GMail notification on new messages - sourcce
function GmailNotificationSource() {
    this._init();
};

GmailNotificationSource.prototype = {
     __proto__:  MessageTray.Source.prototype,

    _init: function() {
        Logger.log("GmailNotificationSource._init start");
        MessageTray.Source.prototype._init.call(
            this, _("New gmail message"));

        this._setSummaryIcon(this.createNotificationIcon());
        this._nbNotifications = 0;
    },

    notify: function(notification) {
        Logger.log("GmailNotificationSource.notify start");
        MessageTray.Source.prototype.notify.call(this, notification);

        this._nbNotifications += 1;

        // Display the source while there is at least one notification
        notification.connect('destroy', Lang.bind(this, function () {
            this._nbNotifications -= 1;

            if (this._nbNotifications == 0)
                this.destroy();
        }));
    },

    createNotificationIcon: function() {
        return Clutter.Texture.new_from_file(extensionPath+"/icons/gmail-icon48.png");
    }

};

// GMail notification on new messages - notification
function GmailNotification(source, content) {
    this._init(source, content);
};

GmailNotification.prototype = {
    __proto__: MessageTray.Notification.prototype,

    _init: function(source, content) {
        Logger.log("GmailNotification._init start");
        MessageTray.Notification.prototype._init.call(this,
                                                      source,
                                                      _("New mail from %s").format(content.from),
                                                      null,
                                                      { customContent: true });
        this.expanded = true;
        this._table.add_style_class_name('multi-line-notification');
        let blayout= new St.BoxLayout({ vertical: false });
        let layout = new St.BoxLayout({ vertical: true });

        let label = new St.Label({ text: (Date(content.date)).toLocaleString()});
        label.set_style("font-size:10px;")
        layout.add(label);
        let label1 = new St.Label({ text: content.subject });
        layout.add(label1);
        blayout.add(layout);
        this.addActor(blayout);
    },

    _canExpandContent: function() {
       return true;
    },

    destroy: function() {
        MessageTray.Notification.prototype.destroy.call(this);
    }

};

// GMail notification on new message - notification trigger
function _mailNotify(content) {
    Logger.log("_mailNotify start");
    let source = new GmailNotificationSource();
    Main.messageTray.add(source);

    for (let i=0; i<content.length; i++){
        let notification = new GmailNotification(source, content[i]);
        notification.setTransient(true);
        source.notify(notification);
    }
};

// Check inbox for all accounts trigger
function checkInboxForAllAccounts() {
    Logger.log("checkInbox start");
    for (let i = 0; i < goaAccounts.length; i++) {
        Logger.log("Inbox check for " + goaAccounts[i]._conn._oMail.imap_user_name);
        goaAccounts[i].scanInbox();
    }
    return true;
};

// Process IMAP data
function _processData(oImap,resp,error) {
    Logger.log("_processData start");

    //FIXME WTF?
    let numGoogle = 0;

    let maxId=0;
    let maxSafeId='';

    let totalMessages = 0;
    let unreadMessages = 0;
    for (let i=0; i<oImap.folders.length; i++){
        unreadMessages += oImap.folders[i].unseen;
        totalMessages += oImap.folders[i].messages;
        for (let j=0; j<oImap.folders[i].list.length; j++){
            if (oImap.folders[i].list[j].id > maxId)
                maxId = oImap.folders[i].list[j].id;
            if (oImap.folders[i].list[j].safeid > maxSafeId)
                maxSafeId = oImap.folders[i].list[j].safeid;
        }
    }
    Logger.log("maxSafeId= " +maxSafeId);
    Logger.log("total= " + totalMessages);
    Logger.log("unseen= " + unreadMessages);
    let entry = config.get_int(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id);
    let safeentry = config.get_string(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id+'_safe');
    entry = typeof(entry) !='undefined' && entry!=null ? entry : 0;
    safeentry = typeof(safeentry) !='undefined'  && safeentry!=null ? safeentry : '';
    Logger.log("safeentry= " +safeentry);
    Logger.log("entry= " +entry)

    if (maxId > entry){
        for (let i=0;i<oImap.folders.length;i++){
            var notes=new Array();
            for (let j=0;j<oImap.folders[i].list.length;j++){
                if (oImap.folders[i].list[j].id>entry){
                    notes.push(oImap.folders[i].list[j]);
                }
            }
            if (notes.length>0 && config._notify) {
                _mailNotify(notes);
            }

        }
        config.set_int(GCONF_ACC_KEY+"/"+oImap._conn._oAccount.get_account().id,maxId);
    }
    //todo:get not only from inbox
    Logger.log("Num google:"+numGoogle);
    Logger.log("Setting Content 0:"+oImap.folders[0].list.length);
    Logger.log("Setting Content 1:"+oImap._conn._oAccount.get_account().identity);

    button.setContent(oImap.folders[0].list,numGoogle,oImap._conn._oAccount.get_account().identity);
    oImap._conn._disconnect();
    button.text.clutter_text.set_markup(bText.format(unreadMessages.toString(), totalMessages.toString()));
    button.setIcon(unreadMessages);
};

// Initialize mailboxes
function _initMailboxes() {
    Logger.log("_initMailboxes start");
    let aClient=Goa.Client.new_sync (null);
    let accounts = aClient.get_accounts();

    Logger.log("Found " + accounts.length + " account(s) in GOA");

    for (let i=0; i < accounts.length; i++) {
        let account = accounts[i].get_account()

        if ( account.provider_name.toUpperCase() == "GOOGLE") {
            Logger.log("Account " + i + " ," + "id:" + account.id);

            let goaAccount = new Gmail.GmailImap(accounts[i]);
            goaAccount.connect('inbox-scanned',_processData);
            goaAccount.connect('inbox-fed',_processData);

            goaAccounts.push(goaAccount);
            Logger.log("Added " + account.id + " account");
        }
    }
};

// FIXME WTF?
function openGMailInBrowser(object, event) {
    Logger.log("openGMailInBrowser start");
    if (config._reader==0) {
        if (config._browser =="") {
            Logger.log("no default browser set")
        } else {
            if (object.link!='' && typeof(object.link)!='undefined'){
                Logger.log("Opening link = '" + object.link + "'")
                Utils.trySpawnCommandLine(config._browser+" \""+object.link + "\"");
            } else {
                Utils.trySpawnCommandLine(config._browser+" http://www.gmail.com");
            }
        }
    } else {
        if (config._mail =="") {
            Logger.log("no default mail reader")
        } else {
         Utils.trySpawnCommandLine(config._mail);
        }
    }
};

//
// Gmail Button
//
function GmailButton() {
    this._init();
};

GmailButton.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init: function() {
        Logger.log("GmailButton._init start");
        PanelMenu.Button.prototype._init.call(this, 0.0);
        this._label = new St.Bin({ style_class: 'panel-button',
                                   reactive: true,
                                   can_focus: true,
                                   x_fill:true,
                                   y_fill: false,
                                   track_hover:true });
        this._box = new St.BoxLayout();

        this._icon_grey=Clutter.Texture.new_from_file(
                extensionPath+"/icons/gmaillogo-notifier-grey.svg");
        this._icon_red=Clutter.Texture.new_from_file(
                extensionPath+"/icons/gmaillogo-notifier-red.svg");
        this._icon = this._icon_grey;
        this._box.add_actor(this._icon_grey, 1);
        this._box.add_actor(this._icon_red, 1);
        this.text = new St.Label({text: "0 (0)" });
        this.etext = new St.Label({text: ""});
        this._box.add_actor(this.text,2);
        this._box.add_actor(this.etext,3);
        this._label.set_child(this._box);

        this.actor.add_actor(this._label);
    },

    showNumbers : function (show) {
        Logger.log("GmailButton.showNumbers start")
        if (show == 0 ){
            this.text.hide();
            this.etext.show();
        } else {
            this.text.show();
            this.etext.hide();
        }
    },

    _showNoMessage : function() {
        Logger.log("GmailButton.showNoMessage start");
        let note = new Imap.ImapMessage();
        note.date = new Date();
        note.subject = _('No new messages');
        let msg = new GmailMenuItem(note,
                                   {reactive: true});
        msg.connect('activate',
                    openGMailInBrowser);
        this.menu.addMenuItem(msg, 0);
        this.msgs.push(msg)
    },

    _showError : function(err) {
        Logger.log("GmailButton._showError start")
        let note = new Imap.ImapMessage();
        note.date = new Date();
        note.subject = _(err);
        let msg = new GmailMenuItem(note,
                                   {reactive: true});
        this.menu.addMenuItem(msg,0);
        this.msgs.push(msg)
    },

    _onButtonPress: function(actor, event) {
        Logger.log("GmailButton._onButtonPress ("+ event.get_button().toString() + ")");
        if (event.get_button() == 1){
            // Show submenu if pressed using left button
            if (!this.menu.isOpen) {
                let monitor = Main.layoutManager.primaryMonitor;
                this.menu.actor.style = ('max-height: ' +
                                     Math.round(monitor.height - Main.panel.actor.height) +
                                     'px;');
            }
            if (this.submenu !=null && typeof(this.submenu)!='undefined'){
                this.submenu.destroy();
            }
            this.menu.toggle();
        } else {
            // Check inbox if pressed using other buttons (e.g right)
            checkInboxForAllAccounts();
        }
    },

    _onDestroy: function() {},

    setIcon : function (numberOfUnreadMessages) {
        Logger.log("setIcon n=" + numberOfUnreadMessages);
        if (numberOfUnreadMessages == 0) {
            this._icon=this._icon_grey.show();
            this._icon=this._icon_red.hide();
        } else {
            this._icon=this._icon_grey.hide();
            this._icon=this._icon_red.show();
        }
    },

};

//FIXME: join this with previous prototype
GmailButton.prototype.setContent=function (content, add, mailbox) {
    Logger.log("GmailButton.setContent");
    add = typeof(add) == 'undefined' ? 0 : add;
    mailbox = typeof(mailbox) == 'undefined' ? '' : mailbox;
    Logger.log("Gmail set content: 1");
    if (add == 0) {
        Main.panel._menus.removeMenu(this.menu);
        this.menu.destroy();
        this.menu = new PopupMenu.PopupMenu(this.actor,
                                            0.0,
                                            St.Side.TOP);
        this.menu.actor.add_style_class_name('panel-menu');
        this.menu.connect('open-state-changed',
                          Lang.bind(this, this._onOpenStateChanged));
        this.menu.actor.connect('key-press-event',
                                Lang.bind(this, this._onMenuKeyPress));
        Main.uiGroup.add_actor(this.menu.actor);
        this.menu.actor.hide();
        this.msgs=new Array();
        this.boxes=new Array();
    }

    Logger.log("Gmail set content: 2");
    if (typeof(content) != 'undefined'){
        Logger.log("Gmail set content: 3");

        if (content.length>0){
            Logger.log("Gmail set content: 4");
            // Show no more than 10 messages
            // TODO Make this value configurable
            for (let k=0; k<Math.min(content.length, 10); k++){
                let msg = new GmailMenuItem(content[k],
                                            {reactive: true});
                msg.connect('activate', openGMailInBrowser);
                this.menu.addMenuItem(msg, 0);
                this.msgs.push(msg);
            }
        } else {
            this._showNoMessage();
        }

        let mbox=new MailboxMenuItem(mailbox);
        mbox.connect('activate', openGMailInBrowser);
        this.boxes.push(mbox);
        this.menu.addMenuItem(mbox, 0);
    } else {
        this._showNoMessage();
    }
    this.sep = new PopupMenu.PopupSeparatorMenuItem();
    this.menu.addMenuItem(this.sep);
    Main.panel._menus.addMenu(this.menu);
}

function GmailMenuItem() {
    this._init.apply(this, arguments);
};

GmailMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (content, params) {
        Logger.log("GmailMenuItem._init");
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        this.label= new St.BoxLayout({ vertical: false });
        let layout = new St.BoxLayout({ vertical: true });

        // Display avatar
        let iconBox = new St.Bin({ style_class: 'avatar-box' });
        iconBox._size = 48;
        iconBox.child = Clutter.Texture.new_from_file(
                        extensionPath + "/icons/gmail-icon32.png");
        iconBox.set_style("padding-right:10px;padding-left:10px;")
        this.label.add(iconBox);

        // subscription request message
        let dts = '';
        try {
            let dt = new Date(content.date);
            dts += dt.getFullYear().toString() + "-"
                +  (dt.getMonth()+1).toString() + "-"
                +  dt.getDate().toString() + " "
                +  dt.getHours().toString() + ":"
                +  dt.getMinutes().toString();
        } catch (err) {
            Logger.log('Date converison error in gmail menu item proto');
        }

        dts += " " + content.from;
        let label = new St.Label({ text: dts});
        Logger.log('dts added');
        label.set_style("font-size:10px;")
        layout.add(label);
        let subtext = '';
        this.link = content.link;

        //Show no more than 50 chars from subject
        // TODO Make this value configurable
        try {
            if (content.subject.length > 50) {
                subtext += content.subject.substr(0,50) + '...';
            } else {
                subtext += content.subject;
            }
        } catch (err){
            Logger.log('Subject converison error in gmail menu item proto' + err.message);
        }
        let label1 = new St.Label({ text: subtext });
        layout.add(label1);
        this.label.add(layout);

        this.addActor(this.label);
    }
};


// Mailbox menu
function MailboxMenuItem() {
    this._init.apply(this, arguments);
};

MailboxMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function (text, params) {
        Logger.log("MailboxMenuItem._init");
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);
        this.label= new St.BoxLayout({ vertical: false });
        let iconBox = new St.Bin({ style_class: 'avatar-box' });
        iconBox._size = 48;
        iconBox.child = Clutter.Texture.new_from_file(extensionPath+"/icons/mailbox.png");
        iconBox.set_style("padding-right:10px")
        this.label.add(iconBox);
        let mailbox = new St.Label({ text: text});
        mailbox.set_style("font-size:14px;")
        this.label.add(mailbox);
        this.addActor(this.label);
    }
};


// Configuration
var GmailConf=function () {
    this._init();
};

GmailConf.prototype = {
    _init : function () {
        Logger.log("GmailConf._init");
        this._client = GConf.Client.get_default();

        //some value init
        try {
            this._browser = Gio.app_info_get_default_for_uri_scheme("http").get_executable();
        } catch (err) {
            this._browser = "firefox";
            Logger.log("Config init browser : " + err.message);
        }

        try {
            this._mail = Gio.app_info_get_default_for_uri_scheme("mailto").get_executable();
        } catch (err) {
            Logger.log("Config init mail : " + err.message);
             this._mail = "";
        }

        let ival,sval;
        ival=this._client.get(GCONF_DIR + '/timeout');
        if (ival==null || typeof(ival)=='undefined') {
            this._client.set_int(GCONF_DIR+'/timeout',CHECK_TIMEOUT);
        }

        ival=this._client.get(GCONF_DIR+'/reader');
        if (ival==null || typeof(ival)=='undefined') {
            this._client.set_int(GCONF_DIR+'/reader',0);

        }
        ival=this._client.get(GCONF_DIR+'/position');
        if (ival==null || typeof(ival)=='undefined') {
            this._client.set_int(GCONF_DIR+'/position',0);

        }
        ival=this._client.get(GCONF_DIR+'/numbers');
        if (ival==null || typeof(ival)=='undefined') {
            this._client.set_int(GCONF_DIR+'/numbers',1);

        }
        ival=this._client.get(GCONF_DIR+'/notify');
        if (ival==null || typeof(ival)=='undefined') {
            this._client.set_int(GCONF_DIR+'/notify',1);
        }
        ival=this._client.get(GCONF_DIR+'/vcheck');
        if (ival==null || typeof(ival)=='undefined') {
            this._client.set_int(GCONF_DIR+'/vcheck',1);
        }
        sval=this._client.get_string(GCONF_DIR+'/btext');
        if (sval=="" || sval==null || typeof(sval)=='undefined') {
            this._client.set_string(GCONF_DIR+'/btext',"%s (%s)");
        }
        this._notify=this._client.get_int(GCONF_DIR+'/notify');
        this._numbers=this._client.get_int(GCONF_DIR+'/numbers');
        this._position=this._client.get_int(GCONF_DIR+'/position');
        this._reader=this._client.get_int(GCONF_DIR+'/reader');
        this._timeout=this._client.get_int(GCONF_DIR+'/timeout');
        this._vcheck=this._client.get_int(GCONF_DIR+'/vcheck');
        this._btext=this._client.get_string(GCONF_DIR+'/btext');

        //event binding
        this._client.add_dir(GCONF_DIR,GConf.ClientPreloadType.PRELOAD_RECURSIVE);
        this.np=this._client.notify_add(GCONF_DIR,Lang.bind(this,this._onNotify),this,Lang.bind(this,this._onDestroy));
        this.pid=this._client.connect('value-changed',Lang.bind(this,this._onValueChanged));

    },

    _readValues : function() {
        Logger.log("GmailConf._readValues");
        this._timeout=this._client.get_int(GCONF_DIR+'/timeout');
        this._reader=this._client.get_int(GCONF_DIR+'/reader');
        this._position=this._client.get_int(GCONF_DIR+'/position');
        this._numbers=this._client.get_int(GCONF_DIR+'/numbers');
        this._notify=this._client.get_int(GCONF_DIR+'/notify');
        this._vcheck=this._client.get_int(GCONF_DIR+'/vcheck');
        this._btext=this._client.get_string(GCONF_DIR+'/btext');
    },

    set_int : function (key,val){
        return this._client.set_int(key,val)
    },
    get_int : function (key){
        return this._client.get_int(key)
    },
    set_string : function (key,val){
        return this._client.set_string(key,val)
    },
    get_string : function (key){
        return this._client.get_string(key)
    },
    _onNotify : function (client,object,p0) {
        return true;
    },
    _onDestroy : function (client,object,p0) {
        return true;
    },
    _onValueChanged : function (client,key,p0) {
        try {
            Logger.log("Value change: "+key);
            switch (key) {
                case GCONF_DIR+'/position' :
                    hide();
                    this._position=this._client.get_int(GCONF_DIR+'/position');
                    show();
                    break;

                case GCONF_DIR+'/timeout' :
                    this._timeout=this._client.get_int(GCONF_DIR+'/timeout');
                    let ret=Mainloop.source_remove(periodicInboxCheckEvent);
                    periodicInboxCheckEvent = null;
                    periodicInboxCheckEvent = GLib.timeout_add_seconds(0,this._timeout, checkInboxForAllAccounts);
                    break;

                case GCONF_DIR+'/reader' :
                    this._reader=this._client.get_int(GCONF_DIR+'/reader');
                    break;

                case GCONF_DIR+'/numbers' :
                    this._numbers=this._client.get_int(GCONF_DIR+'/numbers');
                    button.showNumbers(this._numbers);
                    break;

                case GCONF_DIR+'/notify' :
                    this._notify=this._client.get_int(GCONF_DIR+'/notify');
                    break;

                case GCONF_DIR+'/btext' :
                    this._btext=this._client.get_string(GCONF_DIR+'/btext');
                    bText=this._btext ;
                    break;

                case GCONF_DIR+'/vcheck' :
                    this._vcheck=this._client.get_int(GCONF_DIR+'/vcheck');
                    break;
            }
        } catch (err) {
            Logger.log("error:" + err.message);
        }
        return true;
    },
    _disconnectSignals: function() {
        this._client.notify_remove(this.np);
        this._client.remove_dir(GCONF_DIR);
        this._client.disconnect(this.pid);
    }

}

//FIXME Read configuration changes
//Signals.addSignalMethods(GmailConf.prototype);

// Show gmail button in the panel box
function show() {
    let panelPositionbox = null;
    switch (config._position) {
        case 0:  panelPositionbox = Main.panel._rightBox;  break;
        case 1:  panelPositionbox = Main.panel._centerBox; break;
        case 2:  panelPositionbox = Main.panel._leftBox;   break;
        default: panelPositionbox = Main.panel._rightBox;  break;
    }
    panelPositionbox.add_actor(button.actor);
};

// Hide gmail button
function hide() {
    let panelPositionbox = null;
    switch (config._position) {
        case 0:  panelPositionbox = Main.panel._rightBox;  break;
        case 1:  panelPositionbox = Main.panel._centerBox; break;
        case 2:  panelPositionbox = Main.panel._leftBox;   break;
        default: panelPositionbox = Main.panel._rightBox;  break;
        }
    panelPositionbox.remove_actor(button.actor);
}

// Initialize the extension
function init(extensionMeta) {
    extensionPath = extensionMeta.path;

    // Initialize loggin
    Logger.historyPath = extensionPath + '/gmailNotify.log';
    Logger._historyFile = Gio.file_new_for_path(Logger.historyPath);

    Logger.log('Gmail Notifier starting up, version: '+_version);
    let userExtensionLocalePath = extensionPath + '/locale';
    imports.gettext.bindtextdomain('gmail_notify',
                                   userExtensionLocalePath);
};

// Enabling the gmail button
function enable() {
    Logger.log("enable");
    let userExtensionLocalePath = extensionPath + '/locale';

    config = new GmailConf();
    if (config == null )
        config = new GmailConf();

    button = new GmailButton();
    bText = config._btext;
    Logger.log('init numbers '+config._numbers);
    button.showNumbers(config._numbers);
    button.setIcon(0);
    button.setContent();

    show();
    _initMailboxes();
    periodicInboxCheckEvent = GLib.timeout_add_seconds(0,
                                                       config._timeout,
                                                       checkInboxForAllAccounts);
    checkInboxForAllAccounts();
};

// Disabling the gmail button
function disable() {
    hide();
    config._disconnectSignals();
    config = null;
    Mainloop.source_remove(periodicInboxCheckEvent);
    goaAccounts = null;
}
