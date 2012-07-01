/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/**
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;

const Gettext = imports.gettext.domain('gnome-shell-extensions-gmail-notify');
const _ = Gettext.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Lib = Me.imports.lib;
const Convenience = Me.imports.convenience;

let settings_choice;
let settings_string;
let settings_bool;
let settings_range;

function init() {
    this._settings = Convenience.getSettings();
    settings_choice = {
        "position": { label: _("Button position"),
                      options: {"Left"  : 2,
                                "Center": 1,
                                "Right" : 0},
                  }
    }
    settings_string = {
        "number-format": { label: _("Text format"),
                           help: _("Available replacements:"
                                 + "{unread} - number of unread messages"
                                 + "{total} - total number of messages in inbox"),
                           default: "{unread} ({total})"}
    }
    settings_bool = {
        "notify-on-new-messages" : {label: _("Notify about incoming mail")},
        "use-default-mail-reader": {label: _("Use default mail reader instead of gmail in browser")},
        "show-unread-numbers"    : {label: _("Show number of unread messages")},
    };
    settings_range = {
        "timeout": {label: _("Check interval"),
                  help: _("Amount of time to check for new messages in seconds"),
                  min: 60, max: 360, step: 30, default: 180}
    };
}

function createRangeSetting(setting) {
    let hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });

    let setting_label = new Gtk.Label({ label: settings_range[setting].label,
                                        xalign: 0 });

    let setting_range = Gtk.HScale.new_with_range( settings_range[setting].min,
                                                   settings_range[setting].max,
                                                   settings_range[setting].step);
    setting_range.set_value(this._settings.get_int(setting));
    setting_range.set_draw_value(false);
    setting_range.add_mark(settings_range[setting].default,
                           Gtk.PositionType.BOTTOM, null);
    setting_range.set_size_request(200, -1);
    setting_range.connect('value-changed', function(slider) {
        this._settings.set_int(setting, slider.get_value());
    });

    if (settings_range[setting].help) {
        setting_label.set_tooltip_text(settings_range[setting].help)
        setting_range.set_tooltip_text(settings_range[setting].help)
    }

    hbox.pack_start(setting_label, true, true, 0);
    hbox.add(setting_range);

    return hbox;
}

function createBoolSetting(setting) {

    let hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });

    let setting_label = new Gtk.Label({label: settings_bool[setting].label,
                                       xalign: 0 });

    let setting_switch = new Gtk.Switch({active: this._settings.get_boolean(setting)});
    setting_switch.connect('notify::active', function(button) {
        _settings.set_boolean(setting, button.active);
    });

    if (settings_bool[setting].help) {
        setting_label.set_tooltip_text(settings_bool[setting].help)
        setting_switch.set_tooltip_text(settings_bool[setting].help)
    }

    hbox.pack_start(setting_label, true, true, 0);
    hbox.add(setting_switch);

    return hbox;
}

function createStringSetting(setting) {

    let hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });

    let setting_label = new Gtk.Label({label: settings_string[setting].label,
                                       xalign: 0 });

    let setting_entry = new Gtk.Entry({text: this._settings.get_string(setting)});
    setting_entry.connect('notify::leave', function(entry) {
        this._settings.set_string(setting, entry.text);
    });

    if (settings_string[setting].help) {
        setting_label.set_tooltip_text(settings_string[setting].help)
        setting_entry.set_tooltip_text(settings_string[setting].help)
    }

    hbox.pack_start(setting_label, true, true, 0);
    hbox.add(setting_entry);

    return hbox;
}

function createChoiceSetting(setting) {

    this._model = new Gtk.ListStore();
    this._model.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);
    for (option in settings_choice[setting].options) {
        let value = settings_choice[setting].options[option];
        this._model.insert_with_valuesv(-1, [ 0, 1 ], [ option, value ]);
    }
    

    let hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL });

    let setting_label = new Gtk.Label({label: settings_choice[setting].label,
                                       xalign: 0 });

    let setting_choice = new Gtk.ComboBox({ margin_left: 8,
                                            hexpand: true });
    setting_choice.set_model(this._model);
    setting_choice.set_active(this._settings.get_int(setting));
    let renderer = new Gtk.CellRendererText();
    setting_choice.pack_start(renderer, true);
    setting_choice.add_attribute(renderer, 'text', 0);

    setting_choice.connect('changed', function(combobox) {
        let [success, iter] = setting_choice.get_active_iter();
        if (!success)
            return;

        _settings.set_int(setting, _model.get_value(iter, 1));
    });

    if (settings_choice[setting].help) {
        setting_label.set_tooltip_text(settings_choice[setting].help)
        setting_choice.set_tooltip_text(settings_choice[setting].help)
    }

    hbox.pack_start(setting_label, true, true, 0);
    hbox.add(setting_choice);

    return hbox;
    
}

function buildPrefsWidget() {
    let frame = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
                              border_width: 10 });
    let vbox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
                             margin: 20, margin_top: 10 });

    for (setting in settings_bool) {
        let hbox = createBoolSetting(setting);
        vbox.add(hbox);
    }

    for (setting in settings_string) {
        let hbox = createStringSetting(setting);
        vbox.add(hbox);
    }

    for (setting in settings_choice) {
        let hbox = createChoiceSetting(setting);
        vbox.add(hbox);
    }


    for (setting in settings_range) {
        let hbox = createRangeSetting(setting);
        vbox.add(hbox);
    }

    frame.add(vbox);
    frame.show_all();
    return frame;
}
