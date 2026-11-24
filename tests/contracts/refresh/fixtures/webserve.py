class WebInterface(object):

    @cherrypy.expose
    @addtoapi("get_libraries")
    def get_full_libraries_list(self, **kwargs):
        """ Get a list of all libraries on your server.

            Returns:
                json:
                    [{"section_id": "2"}]
        """
        return []

    @cherrypy.expose
    @addtoapi()
    def get_activity(self, session_key=None, **kwargs):
        """ Get the current activity on the PMS. """
        return {}
