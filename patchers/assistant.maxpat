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
        "rect": [ 1354.0, 251.0, 720.0, 700.0 ],
        "openinpresentation": 1,
        "boxes": [
            {
                "box": {
                    "id": "obj-jweb",
                    "maxclass": "jweb",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 40.0, 480.0, 360.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 0.0, 0.0, 600.0, 420.0 ],
                    "saved_attributes": {
                        "rendermode": 1
                    },
                    "text": "jweb",
                    "varname": "jweb"
                }
            },
            {
                "box": {
                    "id": "obj-route-ui",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "", "", "" ],
                    "patching_rect": [ 40.0, 420.0, 140.0, 22.0 ],
                    "text": "route prompt clear"
                }
            },
            {
                "box": {
                    "id": "obj-prepend-prompt",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 40.0, 455.0, 100.0, 22.0 ],
                    "text": "prepend prompt"
                }
            },
            {
                "box": {
                    "id": "obj-clear-msg",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 150.0, 455.0, 50.0, 22.0 ],
                    "text": "clear"
                }
            },
            {
                "box": {
                    "id": "obj-assistant",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 40.0, 495.0, 280.0, 22.0 ],
                    "saved_object_attributes": {
                        "autostart": 1,
                        "defer": 0,
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
                    "id": "obj-route-bridge",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 40.0, 535.0, 100.0, 22.0 ],
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
                    "patching_rect": [ 40.0, 575.0, 90.0, 22.0 ],
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
            }
        ],
        "lines": [
            {
                "patchline": {
                    "destination": [ "obj-route-ui", 0 ],
                    "source": [ "obj-jweb", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-prepend-prompt", 0 ],
                    "source": [ "obj-route-ui", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-clear-msg", 0 ],
                    "source": [ "obj-route-ui", 1 ]
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
                    "destination": [ "obj-assistant", 0 ],
                    "source": [ "obj-clear-msg", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-route-bridge", 0 ],
                    "source": [ "obj-assistant", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-v8", 0 ],
                    "source": [ "obj-route-bridge", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jweb", 0 ],
                    "source": [ "obj-route-bridge", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-assistant", 0 ],
                    "midpoints": [ 49.5, 605.0, 22.0, 605.0, 22.0, 487.0, 49.5, 487.0 ],
                    "source": [ "obj-v8", 0 ]
                }
            }
        ],
        "autosave": 0
    }
}
