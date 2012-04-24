//Initialize logging
const Gio = imports.gi.Gio;

var historyPath = null;
var _historyFile = null;
const _DEBUG = true;

function log(message) {
    if (_DEBUG) {
        var callingLine = "";
        try {
            i.dont.exist += 0
        } catch (e) {
            callingLine = e.stack.split('\n')[1];
        }
        //Remove extension path from callingLine
        callingLine = callingLine.replace(/.*\//i, "")

        //global.log("GN: " + callingLine + ": " + message)
        let output = this._historyFile.append_to(Gio.FileCreateFlags.NONE, null);
        let dataOut = new Gio.DataOutputStream({ base_stream: output });
        dataOut.put_string(
            new Date().toLocaleTimeString() + "\t" + callingLine + "\t" + message + "\n", null);
        dataOut.close(null);
    }
}
