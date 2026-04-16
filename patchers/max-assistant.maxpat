{
    "patcher": {
        "fileversion": 1,
        "appversion": {
            "major": 9,
            "minor": 1,
            "revision": 4,
            "architecture": "x64",
            "modernui": 1
        },
        "classnamespace": "box",
        "rect": [ 1230.0, 308.0, 520.0, 540.0 ],
        "openinpresentation": 1,
        "boxes": [
            {
                "box": {
                    "bgcolor": [ 0.18, 0.18, 0.2, 1.0 ],
                    "border": 1.0,
                    "bordercolor": [ 0.35, 0.35, 0.4, 1.0 ],
                    "id": "obj-inp",
                    "keymode": 1,
                    "lines": 3,
                    "maxclass": "textedit",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [ "", "int", "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 40.0, 40.0, 260.0, 60.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 10.0, 10.0, 220.0, 50.0 ],
                    "rounded": 6.0,
                    "text": "привет",
                    "textcolor": [ 0.95, 0.95, 0.95, 1.0 ],
                    "varname": "inp"
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.25, 0.25, 0.28, 1.0 ],
                    "fontsize": 11.0,
                    "id": "obj-clear-btn",
                    "maxclass": "textbutton",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "", "", "int" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 320.0, 40.0, 80.0, 26.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 240.0, 10.0, 70.0, 26.0 ],
                    "rounded": 6.0,
                    "text": "new chat",
                    "textcolor": [ 0.95, 0.95, 0.95, 1.0 ],
                    "varname": "clear_btn"
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.12, 0.12, 0.14, 1.0 ],
                    "border": 1.0,
                    "bordercolor": [ 0.35, 0.35, 0.4, 1.0 ],
                    "id": "obj-out",
                    "lines": 10,
                    "maxclass": "textedit",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [ "", "int", "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 40.0, 380.0, 400.0, 140.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 10.0, 50.0, 300.0, 180.0 ],
                    "readonly": 1,
                    "rounded": 6.0,
                    "textcolor": [ 0.85, 0.95, 0.85, 1.0 ],
                    "varname": "out"
                }
            },
            {
                "box": {
                    "id": "obj-clear-msg",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 320.0, 80.0, 40.0, 22.0 ],
                    "text": "clear"
                }
            },
            {
                "box": {
                    "id": "obj-tosymbol",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 120.0, 60.0, 22.0 ],
                    "text": "tosymbol"
                }
            },
            {
                "box": {
                    "id": "obj-prepend-prompt",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 150.0, 100.0, 22.0 ],
                    "text": "prepend prompt"
                }
            },
            {
                "box": {
                    "id": "obj-assistant",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 40.0, 190.0, 280.0, 22.0 ],
                    "saved_object_attributes": {
                        "autostart": 1,
                        "defer": 0,
                        "node_bin_path": "",
                        "npm_bin_path": "",
                        "watch": 1
                    },
                    "text": "node.script assistant.js @autostart 1 @watch 1",
                    "textfile": {
                        "filename": "assistant.js",
                        "flags": 0,
                        "embed": 0,
                        "autowatch": 1
                    },
                    "varname": "assistant"
                }
            },
            {
                "box": {
                    "id": "obj-r-bridge",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 40.0, 230.0, 90.0, 22.0 ],
                    "text": "route bridge"
                }
            },
            {
                "box": {
                    "filename": "bridge.js",
                    "id": "obj-v8",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 270.0, 90.0, 22.0 ],
                    "saved_object_attributes": {
                        "parameter_enable": 0
                    },
                    "text": "v8 bridge.js",
                    "textfile": {
                        "filename": "bridge.js",
                        "flags": 0,
                        "embed": 0,
                        "autowatch": 1
                    },
                    "varname": "v8"
                }
            },
            {
                "box": {
                    "id": "obj-r-reply",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 180.0, 270.0, 80.0, 22.0 ],
                    "text": "route reply"
                }
            },
            {
                "box": {
                    "id": "obj-prepend-set",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 180.0, 310.0, 80.0, 22.0 ],
                    "text": "prepend set"
                }
            }
        ],
        "lines": [
            {
                "patchline": {
                    "destination": [ "obj-r-bridge", 0 ],
                    "source": [ "obj-assistant", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-clear-msg", 0 ],
                    "source": [ "obj-clear-btn", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-assistant", 0 ],
                    "source": [ "obj-clear-msg", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-tosymbol", 0 ],
                    "source": [ "obj-inp", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-assistant", 0 ],
                    "source": [ "obj-prepend-prompt", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-out", 0 ],
                    "source": [ "obj-prepend-set", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-r-reply", 0 ],
                    "source": [ "obj-r-bridge", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-v8", 0 ],
                    "source": [ "obj-r-bridge", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-prepend-set", 0 ],
                    "source": [ "obj-r-reply", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-prepend-prompt", 0 ],
                    "source": [ "obj-tosymbol", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-assistant", 0 ],
                    "midpoints": [ 49.5, 300.0, 22.0, 300.0, 22.0, 182.0, 49.5, 182.0 ],
                    "source": [ "obj-v8", 0 ]
                }
            }
        ],
        "autosave": 0
    }
}